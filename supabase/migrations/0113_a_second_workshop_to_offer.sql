-- Producer Agent — 第二个「可提供」：The Producer You Can't Afford
--
-- 他要的（2026-08-21）：把 hudiworks.com/workshop/producer/ 那门课放进
-- 「工作坊 · 可提供」，并且保证 Fairwind 干活时用得上这份信息。
--
-- 定位（他明确说的，别照抄报名页）：报名页上的「4 周 · 每周内容」只是
-- 2026-09-15 首期的形态，不是这门课的定义。对外 offer 时的弹性是
-- 最短 2 课时、最长一个普通学期的实践指导；卖点是内容本身、效率提升、
-- 与 art practice 相关的定制、面向 artist 和独立创作者的 career strategy。
--
-- 上一条 offer（Paperbark）当年是直接 SQL 插生产库的，仓库里没有底——
-- 这条从一开始就落成 migration，绝不丢信息。
-- 盒子进 Fairwind 的 prompt 靠的是 brain/prompt.js entriesBlock 同日的改动。

insert into producer.works (kind, title, medium, year, body, source, sort, tags, box, meta)
select
  'offer',
  'The Producer You Can''t Afford — Workshop',
  '工作坊（2 课时 ～ 一学期均可，按团体定制）',
  '2026',
  'Participants — artists and independent creators — build their own outreach agent: a personal producer that researches opportunities, prepares first drafts, keeps the record straight, and reminds at the right moment. The final words are always the participant''s own, and they decide what goes out. Around the tool sits a career-strategy practice: naming what an art practice actually needs — venues, funding, residencies, collaborators — and building a sustainable outreach rhythm for it. Content is customized to each group''s art practice; the format scales from a two-hour session to a semester-long practicum.',
  'manual',
  92,
  array['workshop', 'AI agent', 'outreach', 'career strategy', 'art practice'],
  jsonb_build_object(
    'page',           '报名页 https://hudiworks.com/workshop/producer/ — 首期 2026-09-15 开课（4 周 · $300 · 最多 10 人）。那只是首期的形态，不是这门课的定义。',
    'formats',        '最短 2 课时，最长一个普通学期的实践指导；内容按团体的 art practice 定制。提案时不要照抄报名页的 4 周结构。',
    'selling_points', '四个卖点：内容本身、效率提升、与 art practice 相关的定制、面向 artist 和独立创作者的 career strategy。',
    'guardrail',      '⚠️ 截至 2026-08-21 首期还没开课（9/15 开）。对外只能说「首期已上线招生」，不能说「教过」。首期结束后才可改口。',
    'copy_rule',      '文案红线：任何对外材料不得说 agent「模仿 ta 的声音写信」（sound like you / writes like you 全禁）。agent 的动词只能是研究、起稿、记录、提醒；每处提到信都要跟「最终的字是 ta 的、ta 来发送」。',
    'reach_out',      '两类对象：院校（艺术院校 / 大学的 professional practice 板块）讲学期版实践指导；机构（residency public program、artist-run space、图书馆 / makerspace 成人课）讲 2 课时 ～ 1 天的浓缩版。',
    'prototype',      'fairwind（ta 自己的外联 agent）是原型；workshop 里每人搭一个自己的。'
  ),
  '{}'::jsonb
where not exists (
  select 1 from producer.works
  where kind = 'offer' and title = 'The Producer You Can''t Afford — Workshop'
);
