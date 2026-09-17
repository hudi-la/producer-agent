-- Producer Agent — 学员出厂的「每周找机会」任务有了提示词
--
-- 2026-09-17，workshop-edition。0141 的注册礼包给每人一条 scout 任务，但没有 prompt；
-- 主线的 scout（0125 起）只跑带 prompt 的任务——所以学员那条从来不会跑。
--
-- 提示词里**一个人名都没有**：画像那段是占位符 {{画像}}，跑的时候 brain 换成「我的档案」
--（brain/scout.js profileBlock）。来源和筛选是产品默认，学员在造卡任务面板里改。
-- 他自己那条（demo/scout-prompt.md）画像是手写的，没有占位符，原样不动。

create or replace function producer.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = producer, public
as $$
begin
  insert into producer.profile (owner) values (new.id) on conflict do nothing;
  insert into producer.voice   (owner) values (new.id) on conflict do nothing;
  insert into producer.tasks   (name, type, schedule, sort, owner, prompt, run_every, run_weekday, run_hour, next_run_at)
  values ('每周找机会', 'scout_aggregators', 'weekly', 10, new.id,
$p$你是这位艺术家的机会跟踪助理，每周例行跑一次。这一步是**往关注表里加行**，不是直接造卡——造哪几张卡由系统后面按「够不够得着」定。

== 画像（筛选标准就是这个，没写的别替 ta 假设）==
{{画像}}

== 来源 ==
两条线都走一遍。

【一】固定聚合源，扫最新内容（用 WebFetch / WebSearch；动态页面抓不到正文就用 WebSearch 兜底，或跳过该源继续）：
- https://creative-capital.org/artist-resources/artist-opportunities/ （该页较重，可能需 WebSearch 兜底）
- https://www.thisiscolossal.com/category/opportunities/ （每月更新，先找到当月那篇 "Opportunities: Open Calls, Residencies, and Grants for Artists"）
- https://www.transartists.org/en/transartists-calls
- https://artinfoland.com/opportunities

【二】搜索，找网上新冒出来的（用 WebSearch，各搜一到两轮，优先近 30 天内发布的）：
- "open call" artists 2026 OR 2027 deadline
- "call for artists" residency OR grant 2026
- artist residency funded "open call" 2026
- 再按画像里的方向和常住地拟两三组关键词，各搜一轮

搜到的每一条都**点进官方页核实**：是不是真的在开放、真实截止、要什么材料。只有聚合站二手转载、找不到官方页的不算数。

== 筛选 ==
- 按画像判断匹配度（★★★ / ★★）；不匹配的丢弃，不用报。
- 合法性辨别：跳过明显的 vanity（高报名费 + 含糊奖项）、要求为领奖付钱、无独立官网等可疑项——这些放进 skipped，写清原因。
- 表里已有的（下面会给名单）不要再报。
- 截止日期以官方页面为准，聚合站上的常是上一届残留。$p$,
          'week', 1, 8, producer.task_next_run('week', 1, 8, now()))
  on conflict do nothing;
  return new;
end
$$;
