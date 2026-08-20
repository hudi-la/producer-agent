-- Producer Agent — follow-up 提前一天到点
--
-- 他的节奏（2026-08-20 说的）：晚上睡前处理这些事，发的邮件都预约到
-- 第二天早上发出。所以 follow-up 在 D 当天早上才进「该动的」就晚了 ——
-- 改成 D-1 早上进：晚上处理时草稿已经在卡里（timerPass 跟着 zone 走，
-- 也会提前一天起草），预约成 D 早上发正好踩点。
--
-- 只提前 WAITING_REPLY。见面不提前（「记得今天见面」提前一天就成谎话）；
-- NEEDS_REPLY / OWE_* 本来就是立刻到点。除 zone 外与 0104 一字不差。

create or replace view public.v_pa_state
with (security_invoker = off) as
with tz as (
  -- 时区直接读表，不调 producer.app_tz()：security_invoker=off 只把**表**
  -- 按 owner 查，函数还是按调用者跑 —— anon 调 producer 的函数会炸。
  select coalesce((select p.data->>'tz' from producer.profile p limit 1),
                  'America/Los_Angeles') as z
),
owned as (
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
-- 信/笔那一支：等对方、等你回
opening as (
  select *,
         case when awaiting is not null then 'WAITING_REPLY'
              when needs_reply          then 'NEEDS_REPLY' end as opened
    from owned
   where subject_id is not null and (awaiting is not null or needs_reply)
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
-- 见面那一支：独立开、独立关
meeting as (
  select distinct on (subject_kind, subject_id) *
    from owned o
   where o.subject_id is not null and o.meet_at is not null
     and not exists (          -- 只有见面类的判断能关一场见面
           select 1 from owned r
            where r.subject_kind = o.subject_kind and r.subject_id = o.subject_id
              and r.at > o.at and r.resolves
              and (r.situation like 'MEETING_SET%' or r.situation like 'DEBRIEF%'
                   or r.situation = '已处理按钮'))
   order by subject_kind, subject_id, meet_at desc   -- 改约 = 更晚的约定顶掉旧的
),
tag_state as (
  select subject_kind, subject_id, opened as state,
         coalesce(awaiting, gist, reply_why) as what,
         reply_why as why, at as since_at,
         case opened when 'WAITING_REPLY' then at + make_interval(days => wait_days)
                     else at end as due_at,
         message_id as anchor_id
    from current_open
  union all
  select subject_kind, subject_id,
         case when now() > meet_at + interval '1 hour' then 'DEBRIEF' else 'MEETING_SET' end,
         coalesce(gist, '约了见面'), null, at, meet_at, message_id
    from meeting
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
     and not exists (
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
           -- 到没到点按**当地的日子**比（0104 的规矩）。
           -- 0108 再加一档：**follow-up 提前一天进「该动的」** —— 他的节奏是
           -- 睡前处理、邮件预约第二天早上发；D-1 早上到点，晚上处理时草稿
           -- 已经在卡里，预约成 D 早上发正好踩点。
           -- 见面不提前：文案是「记得**今天**见面」，提前一天就成谎话了。
           case when (x.due_at at time zone tz.z)::date
                       <= (now() at time zone tz.z)::date
                       + case when x.state = 'WAITING_REPLY' then 1 else 0 end
                then 'due' else 'waiting' end as zone,
           x.anchor_id
      from (
        select * from tag_state
        union all select * from owe_meet
        union all select * from owe_thanks
      ) x
      cross join tz
  ) y
  left join producer.pursuits p on y.subject_kind = 'pursuit' and p.id = y.subject_id
  left join producer.contacts c on y.subject_kind = 'contact' and c.id = y.subject_id
 order by y.subject_kind, y.subject_id,
          (y.zone = 'due') desc,                        -- 到点的优先
          case when y.zone = 'due' then y.due_at end asc,  -- 都到点：急的先
          y.since_at desc;                              -- 都没到点：后发生的赢

grant select on public.v_pa_state to anon, authenticated, service_role;
