-- Producer Agent — state 带上名字；「已处理」立刻算数
--
-- 两件小事：
--
-- 一、界面画一行通知要名字（线的标题 / 人的名字），别让前端再各拉一张表
--     去拼 —— 拼错一次就是「未具名联系人」那种行。视图直接带上。
--
-- 二、OWE_MEETING_NOTE 的关法补一条：**你记了一笔（note/decision）也算**。
--     met_followed_up 只认发出的邮件 —— 可你要是微信里回了、当面说了，
--     按【已处理】记的那一笔应该立刻把这条关掉，跟 NEEDS_REPLY 的
--     纯规则关法一个道理。（meet 本身不算关 —— 又见了一面不等于回过信。）
--
-- 设计稿：docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md 第七节

create or replace view public.v_pa_state
with (security_invoker = off) as
with owned as (
  select t.*, m.created_at as at,
         case when coalesce(pm.pursuit_id, m.pursuit_id) is not null then 'pursuit'
              when m.contact_id is not null then 'contact' end as subject_kind,
         coalesce(pm.pursuit_id, m.pursuit_id, m.contact_id) as subject_id
    from producer.message_tags t
    join producer.pursuit_messages m
      on m.id = t.message_id and m.deleted_at is null and m.kind <> 'gmail_draft'
    left join lateral (
      select v.pursuit_id from public.v_pa_pursuit_mail v
       where v.id = m.id and v.on_this_line
       order by v.created_at desc limit 1
    ) pm on true
),
opening as (
  select *,
         case when awaiting is not null then 'WAITING_REPLY'
              when needs_reply          then 'NEEDS_REPLY'
              when meet_at is not null  then 'MEETING_SET' end as opened
    from owned
   where subject_id is not null
     and (awaiting is not null or needs_reply or meet_at is not null)
),
current_open as (
  select distinct on (subject_kind, subject_id) *
    from opening o
   where not exists (
           select 1 from owned r
            where r.subject_kind = o.subject_kind and r.subject_id = o.subject_id
              and r.at > o.at and r.resolves)
     and not (o.opened = 'NEEDS_REPLY' and exists (
           select 1 from producer.pursuit_messages n
            where ((o.subject_kind = 'pursuit' and n.pursuit_id = o.subject_id)
                or (o.subject_kind = 'contact' and n.contact_id = o.subject_id))
              and n.kind in ('note', 'meet', 'decision')
              and n.deleted_at is null and n.created_at > o.at))
   order by subject_kind, subject_id, at desc
),
tag_state as (
  select subject_kind, subject_id,
         case when opened = 'MEETING_SET' and now() > meet_at + interval '1 hour'
              then 'DEBRIEF' else opened end as state,
         coalesce(awaiting, gist, reply_why) as what,
         reply_why as why,
         at as since_at,
         case opened
           when 'WAITING_REPLY' then at + make_interval(days => wait_days)
           when 'NEEDS_REPLY'   then at
           else meet_at end as due_at,
         message_id as anchor_id
    from current_open
),
owe_meet as (
  select 'contact'::text as subject_kind, f.subject_id,
         'OWE_MEETING_NOTE'::text as state,
         '和「' || f.name || '」meeting 了，回复一下。' as what,
         null::text as why,
         f.last_meet_at as since_at,
         f.last_meet_at + interval '48 hours' as due_at,
         null::uuid as anchor_id
    from public.v_pa_cue_facts f
   where f.subject_kind = 'contact'
     and f.last_meet_at is not null and not f.met_followed_up
     and not exists (          -- 你记了一笔 → 关（【已处理】走的就是这条）
           select 1 from producer.pursuit_messages n
            where n.contact_id = f.subject_id and n.kind in ('note', 'decision')
              and n.deleted_at is null and n.created_at > f.last_meet_at)
  union all
  select 'pursuit', mm.pursuit_id, 'OWE_MEETING_NOTE',
         '「' || p.title || '」meeting 了，回复一下。',
         null, mm.at, mm.at + interval '48 hours', null
    from (select m.pursuit_id, max(m.created_at) as at
            from producer.pursuit_messages m
           where m.pursuit_id is not null and m.kind = 'meet' and m.deleted_at is null
           group by 1) mm
    join producer.pursuits p on p.id = mm.pursuit_id
   where not exists (
           select 1 from public.v_pa_pursuit_mail v
            where v.pursuit_id = mm.pursuit_id and v.on_this_line
              and v.kind = 'email' and v.role = 'artist' and v.created_at > mm.at)
     and not exists (
           select 1 from producer.pursuit_messages n
            where n.pursuit_id = mm.pursuit_id and n.kind in ('note', 'decision')
              and n.deleted_at is null and n.created_at > mm.at)
),
owe_thanks as (
  select 'contact'::text, i.id, 'OWE_THANKS'::text,
         '见到了你经「' || i.name || '」介绍认识的 '
           || string_agg('「' || c.name || '」', '、' order by ev.at) || '，跟他说一声谢谢。',
         null::text,
         max(ev.at), max(ev.at), null::uuid
    from producer.contacts c
    join producer.contacts i on i.id = c.intro_by
    join lateral (
      select greatest(f.last_in_at, f.last_meet_at) as at, f.org_ever_replied, f.last_meet_at
        from public.v_pa_cue_facts f
       where f.subject_kind = 'contact' and f.subject_id = c.id
    ) ev on ev.org_ever_replied or ev.last_meet_at is not null
   where c.intro_thanked_at is null
   group by i.id, i.name
)
select distinct on (y.subject_kind, y.subject_id)
       y.*, coalesce(p.title, c.name) as subject_name
  from (
    select x.subject_kind, x.subject_id, x.state, x.what, x.why,
           x.since_at, x.due_at,
           case when x.state in ('MEETING_SET')
                  then case when (x.due_at at time zone producer.app_tz())::date
                              <= (now() at time zone producer.app_tz())::date
                            then 'due' else 'waiting' end
                when x.due_at <= now() then 'due'
                else 'waiting' end as zone,
           x.anchor_id
      from (
        select * from tag_state
        union all select * from owe_meet
        union all select * from owe_thanks
      ) x
  ) y
  left join producer.pursuits p on y.subject_kind = 'pursuit' and p.id = y.subject_id
  left join producer.contacts c on y.subject_kind = 'contact' and c.id = y.subject_id
 order by y.subject_kind, y.subject_id, y.since_at desc;

grant select on public.v_pa_state to anon, authenticated, service_role;
