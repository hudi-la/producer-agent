-- Producer Agent — 脏不脏是算出来的
--
-- 视图上加三列：last_event_at（最后一件事什么时候发生的）、judged_upto
-- （上次重判看到哪儿）、stale（脏没脏）。
--
-- **最后一件事包括移卡**：你把 Stanford 移到「发出&提交」，那就是你说了
-- 「这件事我做完了」——判断的输入不只是邮件。
--
-- 为什么算而不存：队列/脏标记会跟事实分叉。pa_seen 在 localStorage 那次、
-- 过卡队列那次，都是同一个形状。水位漂了、判断中断了、迁移重跑了，
-- 下一次一算就知道。
--
-- 设计稿：docs/specs/2026-08-19-rejudge-design.md 第三节
-- 上游：0077（视图原文）· 0078（stage_at / cue_judged）

drop view if exists public.v_pa_cue_facts;
create view public.v_pa_cue_facts as
with 信 as (
  select 'pursuit'::text as subject_kind, v.pursuit_id as subject_id,
         v.role, v.created_at, v.gmail_message_id, v.who, h.subject
    from public.v_pa_pursuit_mail v
    join producer.pursuit_messages m on m.id = v.id and m.deleted_at is null
    left join producer.mail_headers h on h.gmail_message_id = v.gmail_message_id
   where v.on_this_line and v.kind = 'email'
  union all
  select 'contact'::text, m.contact_id,
         m.role, m.created_at, m.gmail_message_id,
         coalesce(c.name, m.counterpart_email), h.subject
    from producer.pursuit_messages m
    left join producer.contacts c on c.id = m.contact_id
    left join producer.mail_headers h on h.gmail_message_id = m.gmail_message_id
   where m.contact_id is not null and m.gmail_message_id is not null
     and m.deleted_at is null and m.kind = 'email'
), 进来的 as (
  select subject_kind, subject_id, max(created_at) as at
    from 信 where role = 'org' group by 1, 2
), 最后一封进来的 as (
  select i.subject_kind, i.subject_id, i.at, x.gmail_message_id, x.who, x.subject
    from 进来的 i
    join lateral (
      select s.gmail_message_id, s.who, s.subject from 信 s
       where s.subject_kind = i.subject_kind and s.subject_id = i.subject_id
         and s.role = 'org' and s.created_at = i.at limit 1) x on true
), 出去的 as (
  select subject_kind, subject_id, max(created_at) as at
    from 信 where role = 'artist' group by 1, 2
), 没回音的 as (
  select s.subject_kind, s.subject_id, count(*)::int as n, max(s.created_at) as at
    from 信 s
    left join 进来的 i
      on i.subject_kind = s.subject_kind and i.subject_id = s.subject_id
   where s.role = 'artist' and s.created_at > coalesce(i.at, '-infinity'::timestamptz)
   group by 1, 2
), 线上的信 as (
  select distinct gmail_message_id from 信
   where subject_kind = 'pursuit' and gmail_message_id is not null
), 最后一封 as (
  select distinct on (subject_kind, subject_id) subject_kind, subject_id, gmail_message_id
    from 信 order by subject_kind, subject_id, created_at desc
), 见过面 as (
  select m.contact_id as subject_id, max(m.created_at) as at
    from producer.pursuit_messages m
   where m.contact_id is not null and m.role = 'note' and m.kind = 'meet'
     and m.deleted_at is null
   group by 1
), 记的一笔 as (
  -- 你手写的东西也算一件事：它会改变「这条线现在怎么样了」。
  -- 两边都收：挂在人名下的和挂在线上的。
  select 'contact'::text as subject_kind, m.contact_id as subject_id,
         max(m.created_at) as at
    from producer.pursuit_messages m
   where m.contact_id is not null and m.kind in ('note','meet','decision')
     and m.deleted_at is null
   group by 1, 2
  union all
  select 'pursuit', m.pursuit_id, max(m.created_at)
    from producer.pursuit_messages m
   where m.pursuit_id is not null and m.kind in ('note','meet','decision')
     and m.deleted_at is null
   group by 1, 2
)
select
  x.subject_kind, x.subject_id, x.name, x.line_title,
  fin.at as last_in_at, fin.gmail_message_id as last_in_id,
  fin.who as last_in_from, fin.subject as last_in_subject,
  fout.at as last_out_at,
  coalesce(run.n, 0) as unanswered_n, run.at as unanswered_at,
  x.next_touch_at, x.next_touch_why,
  x.next_action, x.next_action_by,
  x.intro_by_name, x.intro_thanked_at, x.checkin_at,
  (fin.at is not null) as org_ever_replied,
  (x.subject_kind = 'contact'
   and coalesce(last1.gmail_message_id in (select gmail_message_id from 线上的信), false))
    as mail_on_line,
  meet.at as last_meet_at,
  coalesce(meet.at is not null and fout.at > meet.at, false) as met_followed_up,
  -- ── 脏不脏 ──
  -- 最后一件事：信 / 你记的一笔 / 移卡，三样取大。
  -- **移卡也算一件事** —— 你把卡移到「发出&提交」就是说了「这件事我做完了」。
  greatest(fin.at, fout.at, jot.at, x.stage_at) as last_event_at,
  j.judged_upto,
  -- 脏 = 最后一件事晚于上次重判看到的水位。**算出来的，不是存的** ——
  -- 队列会跟事实分叉，这个项目反复吃过这个亏。
  (greatest(fin.at, fout.at, jot.at, x.stage_at) is not null
   and (j.judged_upto is null
        or greatest(fin.at, fout.at, jot.at, x.stage_at) > j.judged_upto)) as stale
from (
  select 'pursuit'::text as subject_kind, p.id as subject_id,
         coalesce(p.contact_name, p.org, '') as name, p.title as line_title,
         p.next_touch_at, pp.next_touch_why,
         -- next_action 才是那句「到时候没回就催」的真身：条件写在这句话里。
         -- 已经勾掉或作废的不算 —— 那是办完的事，不该再当出处。
         case when pp.next_action_done_at is null and pp.next_action_void_at is null
              then pp.next_action end as next_action,
         pp.next_action_by, pp.stage_at,
         null::text as intro_by_name, null::date as intro_thanked_at, null::date as checkin_at
    from public.v_pa_pursuits p
    join producer.pursuits pp on pp.id = p.id
  union all
  select 'contact', c.id, coalesce(c.name, ''), null,
         c.next_touch_at, c.next_touch_why,
         null::text, 'you'::text, null::timestamptz,
         ib.name, c.intro_thanked_at,
         case when c.last_touch_src = 'checkin' then c.last_touch_at end
    from producer.contacts c
    left join producer.contacts ib on ib.id = c.intro_by
) x
left join 最后一封进来的 fin on fin.subject_kind = x.subject_kind and fin.subject_id = x.subject_id
left join 出去的 fout on fout.subject_kind = x.subject_kind and fout.subject_id = x.subject_id
left join 没回音的 run on run.subject_kind = x.subject_kind and run.subject_id = x.subject_id
left join 最后一封 last1 on last1.subject_kind = x.subject_kind and last1.subject_id = x.subject_id
left join 见过面 meet on x.subject_kind = 'contact' and meet.subject_id = x.subject_id
left join 记的一笔 jot on jot.subject_kind = x.subject_kind and jot.subject_id = x.subject_id
left join producer.cue_judged j
  on j.subject_kind = x.subject_kind and j.subject_id = x.subject_id;

grant select on public.v_pa_cue_facts to anon, authenticated, service_role;
comment on view public.v_pa_cue_facts is
  '由头要用的事实，一行一个对象，全是标量。判据在 src/lib/cues.js';
