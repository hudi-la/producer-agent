-- Producer Agent — 说不出出处的日期，不许上通知栏
--
-- 病：通知栏写着「Weidi Zhang · 你定的日子到了（8/17）」。可他没定过 8/17。
--
-- 病根两层：
--
--   一、`next_touch_why`（0072 加的那一列）**没有任何东西在写它**。
--       写 next_touch_at 的是 handleRefresh，而它是死代码（refreshPursuit
--       只 import 没调用，全局同步走 /mail/sync 纯收信）。加一列没人写的字段，
--       跟 8/12 稿子骂 next_action 的话一字不差：「留着就是一行永远不会更新
--       的字，比空着更坏」。
--
--   二、于是每条都走了兜底那句「你定的日子到了」。而真查下来：
--         Paperbark 8/12  next_action_by='you'      —— 确实是他定的
--         ASU       8/17  next_action_by='fairwind' —— **是 Fairwind 提的**
--         UCSB      8/25  next_action_by='fairwind' —— 同上
--       兜底那句只认「对方的原话」和「你自己定的」两种来源，漏了第三种，
--       然后把漏掉的说成了「你定的」。**编一个出处，比不报更坏。**
--
-- 药：出处有两个真来路，都没有就闭嘴。
--   · next_touch_why —— 对方的原话（"circle back next semester"）
--   · next_action    —— 那条待办的原文，**条件就写在这句话里**
--     真例：「8-12 前没回音就向 Sarah 跟进确认收到 proposal」
--     ——这正是他最初说的那种「到时候没回就催」。它一直在库里，
--       只是 8/12 那一刀把它的显示删了，我这次也没去读它。
--
-- 顺带：`deadline` 那条由头整个撤掉（src/lib/cues.js）。「紧急」筛选开关
-- 已经在做同一件事，而且截止跟「有没有回信」是两码事。
--
-- 上游：0076（先统一 kind，事实才是对的）

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
  coalesce(meet.at is not null and fout.at > meet.at, false) as met_followed_up
from (
  select 'pursuit'::text as subject_kind, p.id as subject_id,
         coalesce(p.contact_name, p.org, '') as name, p.title as line_title,
         p.next_touch_at, pp.next_touch_why,
         -- next_action 才是那句「到时候没回就催」的真身：条件写在这句话里。
         -- 已经勾掉或作废的不算 —— 那是办完的事，不该再当出处。
         case when pp.next_action_done_at is null and pp.next_action_void_at is null
              then pp.next_action end as next_action,
         pp.next_action_by,
         null::text as intro_by_name, null::date as intro_thanked_at, null::date as checkin_at
    from public.v_pa_pursuits p
    join producer.pursuits pp on pp.id = p.id
  union all
  select 'contact', c.id, coalesce(c.name, ''), null,
         c.next_touch_at, c.next_touch_why,
         null::text, 'you'::text,
         ib.name, c.intro_thanked_at,
         case when c.last_touch_src = 'checkin' then c.last_touch_at end
    from producer.contacts c
    left join producer.contacts ib on ib.id = c.intro_by
) x
left join 最后一封进来的 fin on fin.subject_kind = x.subject_kind and fin.subject_id = x.subject_id
left join 出去的 fout on fout.subject_kind = x.subject_kind and fout.subject_id = x.subject_id
left join 没回音的 run on run.subject_kind = x.subject_kind and run.subject_id = x.subject_id
left join 最后一封 last1 on last1.subject_kind = x.subject_kind and last1.subject_id = x.subject_id
left join 见过面 meet on x.subject_kind = 'contact' and meet.subject_id = x.subject_id;

grant select on public.v_pa_cue_facts to anon, authenticated, service_role;
comment on view public.v_pa_cue_facts is
  '由头要用的事实，一行一个对象，全是标量。判据在 src/lib/cues.js';
