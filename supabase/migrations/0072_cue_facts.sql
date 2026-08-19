-- Producer Agent — 由头要用的事实，一行一个对象
--
-- 由头（「现在为什么该动这个人 / 这条线」）要的全部输入，一行一个对象，
-- 全是标量。人和机会线两边共用这一张。
--
-- ══ 为什么是视图，不是前端算 ═══════════════════════════════════
--
-- loadPursuits.js 开头记着那次事故：为了算小红点，首页每 8 秒把全库消息
-- 拉一遍。PostgREST 默认封顶 1000 行——过了这个数它只返回**最老的** 1000 条，
-- 新消息静悄悄不在里面而且不报错。
--
-- 所以「判据两边共用同一份 JS」这句话要成立，前提是**信不进浏览器**。
-- 进浏览器的只有这一行标量，数量级锁死在「你有多少个对象」（几十），
-- 不是「你收过多少封信」（几千）。
--
-- ══ 为什么判据不搬进 SQL ═══════════════════════════════════════
--
-- 那样 cues.js 和这张视图就是两套实现——「同一件事两套实现」正是这一刀
-- 要治的第二条病，换个地方复发。而且 SQL 那份没有测试：这个仓库的测试
-- 只跑 node --test。
--
-- 分工是硬的：**库供事实，JS 拼由头。**
--
-- 设计稿：docs/specs/2026-08-18-notifications-design.md 第四·五节

-- ══ 零、机会线也得说得出「为什么是那天」 ══════════════════════
--
-- contacts 上早有 next_touch_why（0011 那份迁移记着两条真事：LACHSA 和
-- Ruth Asawa SOTA 都给了时间锚点，都因为没人记得再碰而飘掉了）。
-- pursuits 上一直只有 next_touch_at，没有「为什么」。
--
-- 于是机会线的「到日子了」只能说「你定的日子到了」——可那个日子多半
-- 不是你定的，是 Fairwind 读完信定的，或者对方信里写的。**日期永远
-- 说得出出处**，这是由头的硬规矩，机会线不能例外。
alter table producer.pursuits
  add column if not exists next_touch_why text;

comment on column producer.pursuits.next_touch_why is
  '那个该碰日的出处：对方的原话，或你自己定的理由。没有出处的日期不许上卡';

-- 加列会变列序，create or replace 认不了 —— drop 再建（0058 同一个处理）。
-- 查过：这张视图刚建，没有任何东西依赖它。
drop view if exists public.v_pa_cue_facts;
create view public.v_pa_cue_facts as
with 信 as (
  -- 机会线的往来：只算「算这条线的」那些（0052/0053/0055 的 on_this_line 推导）
  select 'pursuit'::text as subject_kind, v.pursuit_id as subject_id,
         v.role, v.created_at, v.gmail_message_id, v.who, h.subject
    from public.v_pa_pursuit_mail v
    join producer.pursuit_messages m on m.id = v.id and m.deleted_at is null
    left join producer.mail_headers h on h.gmail_message_id = v.gmail_message_id
   where v.on_this_line and v.kind = 'email'
  union all
  -- 人的往来：挂在这个人名下、有 gmail id 的那些。
  -- **没有 gmail_message_id 的不算往来**——那是你跟 Fairwind 的商量，
  -- 拿它当往来算，等待期会被你自己的一句嘀咕重置掉（cues.js 的老规矩）。
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
  select i.subject_kind, i.subject_id, i.at,
         x.gmail_message_id, x.who, x.subject
    from 进来的 i
    join lateral (
      select s.gmail_message_id, s.who, s.subject from 信 s
       where s.subject_kind = i.subject_kind and s.subject_id = i.subject_id
         and s.role = 'org' and s.created_at = i.at limit 1) x on true
), 出去的 as (
  select subject_kind, subject_id, max(created_at) as at
    from 信 where role = 'artist' group by 1, 2
), 没回音的 as (
  -- 你连着发出去、中间没人回的最后几封。**对方一回，这一串就断了**——
  -- 「自动勾掉」不是一个功能，它就是这一句。
  select s.subject_kind, s.subject_id, count(*)::int as n, max(s.created_at) as at
    from 信 s
    left join 进来的 i
      on i.subject_kind = s.subject_kind and i.subject_id = s.subject_id
   where s.role = 'artist' and s.created_at > coalesce(i.at, '-infinity'::timestamptz)
   group by 1, 2
), 线上的信 as (
  -- 已经被某条机会线认走的那些信。人那边不该再报一遍。
  select distinct gmail_message_id from 信
   where subject_kind = 'pursuit' and gmail_message_id is not null
), 最后一封 as (
  -- 不分方向，就是这个对象最近的一封。用来判「这段往来是不是已经归了某条线」。
  select distinct on (subject_kind, subject_id)
         subject_kind, subject_id, gmail_message_id
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
  fin.at               as last_in_at,
  fin.gmail_message_id as last_in_id,
  fin.who              as last_in_from,
  fin.subject          as last_in_subject,
  fout.at              as last_out_at,
  coalesce(run.n, 0)   as unanswered_n,
  run.at               as unanswered_at,
  x.next_touch_at, x.next_touch_why, x.deadline_at,
  x.intro_by_name, x.intro_thanked_at, x.checkin_at,
  (fin.at is not null) as org_ever_replied,
  -- 这段往来已经归了某条机会线：人那行就别再报「他回你了 / 该碰了」了。
  -- **只压邮件类的两条**，回谢介绍人 / 48 小时信 / 说好的日子照旧归人。
  -- 判据锚在「最后那封信在不在线上」，所以没被任何线认走的往来
  -- 依然在人那行报得出来 —— 一条都不会丢。
  (x.subject_kind = 'contact'
   and coalesce(last1.gmail_message_id in (select gmail_message_id from 线上的信), false))
    as mail_on_line,
  meet.at              as last_meet_at,
  coalesce(meet.at is not null and fout.at > meet.at, false) as met_followed_up
from (
  -- 机会线。next_touch_why 是上面刚加的列，v_pa_pursuits 还没带它，
  -- 所以回底表取——「日期永远说得出出处」靠的就是这一列。
  select 'pursuit'::text as subject_kind, p.id as subject_id,
         coalesce(p.contact_name, p.org, '') as name,
         p.title as line_title,
         p.next_touch_at, pp.next_touch_why, p.deadline_at,
         null::text as intro_by_name, null::date as intro_thanked_at,
         null::date as checkin_at
    from public.v_pa_pursuits p
    join producer.pursuits pp on pp.id = p.id
  union all
  -- 人。checkin_at = 你按「聊过了」打的那个卡（0034 写的 last_touch_src）。
  select 'contact', c.id, coalesce(c.name, ''), null,
         c.next_touch_at, c.next_touch_why, null::date,
         ib.name, c.intro_thanked_at,
         case when c.last_touch_src = 'checkin' then c.last_touch_at end
    from producer.contacts c
    left join producer.contacts ib on ib.id = c.intro_by
) x
left join 最后一封进来的 fin
  on fin.subject_kind = x.subject_kind and fin.subject_id = x.subject_id
left join 出去的 fout
  on fout.subject_kind = x.subject_kind and fout.subject_id = x.subject_id
left join 没回音的 run
  on run.subject_kind = x.subject_kind and run.subject_id = x.subject_id
left join 最后一封 last1
  on last1.subject_kind = x.subject_kind and last1.subject_id = x.subject_id
left join 见过面 meet
  on x.subject_kind = 'contact' and meet.subject_id = x.subject_id;

grant select on public.v_pa_cue_facts to anon, authenticated, service_role;

comment on view public.v_pa_cue_facts is
  '由头要用的事实，一行一个对象，全是标量。信不进浏览器（1000 行封顶那次事故）；判据在 src/lib/cues.js';
