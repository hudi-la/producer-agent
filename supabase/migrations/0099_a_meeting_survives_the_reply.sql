-- Producer Agent — 见面不许被一封回信带走
--
-- 真例（重放当天撞出来的）：Biayna 8/18 那封「I'll send the link for 12pm」
-- 同时是两件事 —— 要回一句（链接谁发，对个口径），**并且**定了 9/11 12pm
-- 的见面。原来的视图一条标签只开一个 state（awaiting > needs_reply > meet_at
-- 三选一），于是：回信盖住见面 → 你回完信，resolves 把整条标签关掉 →
-- **9/11 那场见面从系统里消失**，当天早上没有提醒。
--
-- 修法两条：
--
-- 一、**meet_at 独立成一支 opening**。一封信可以同时开 NEEDS_REPLY 和
--     MEETING_SET；关它们的途径不同 —— 回信的 resolves 关不掉见面，
--     只有见面类的格子（MEETING_SET x * / DEBRIEF x * / 已处理按钮）
--     判出的 resolves、或改约（更晚的 meet_at 自然顶掉）才关。
--
-- 二、**单一 state 的挑选规则**（一个对象同时只显示一个）：
--       到点了的优先（due 早的先）→ 否则后发生的赢（原合并规则）。
--     效果：回信要紧时先显示回信；回完信，见面自己浮上来；
--     见面当天早上，它压过一切还没到点的等待。
--
-- 设计稿：docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md 第四、六节

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
 order by y.subject_kind, y.subject_id,
          (y.zone = 'due') desc,                        -- 到点的优先
          case when y.zone = 'due' then y.due_at end asc,  -- 都到点：急的先
          y.since_at desc;                              -- 都没到点：后发生的赢

grant select on public.v_pa_state to anon, authenticated, service_role;
