-- Producer Agent — 学员出厂的「每周找机会」任务有了提示词
--
-- 2026-09-17，workshop-edition。0141 的注册礼包给每人一条 scout 任务，但没有 prompt；
-- 主线的 scout（0125 起）只跑带 prompt 的任务——所以学员那条从来不会跑。
--
-- 提示词里**一个人名都没有**：画像那段是占位符 {{画像}}，跑的时候 brain 换成「我的档案」
--（brain/scout.js profileBlock）。找法是通用的一段(2026-09-25 起不带任何具体来源——那是作者自己的积累,不随包发;
-- 这支的文字后来被 0147 重写成同一段),学员在造卡任务面板里改。
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
$p$你是这位艺术家的机会跟踪助理，每周跑一次：按下面的画像找适合 ta 的机会——驻地、资助、公开征集、群展、奖项——把新的加进关注表。造哪几张卡由系统按「够不够得着」决定，不用你挑。

== 画像（筛选标准就是这个，没写的别替 ta 假设）==
{{画像}}

== 怎么找 ==
- 用 WebSearch / WebFetch。从画像出发拟关键词：常住地 + 类型 + 年份（例如「<常住地> artist residency open call <年份>」）、媒介或创作方向 + grant / open call、ta 的身份能申请的资助。
- 每条都点进官方页核实：现在开不开放、真实截止、要什么材料。只有聚合站转载、找不到官方页的不算。
- 当前没开放但值得等的也报，注明预计开放时间。
- 触犯画像里「排除规则」的直接跳过；明显 vanity（高报名费 + 含糊奖项、要为领奖付钱、没有独立官网）放进 skipped 并写清原因。

（这一段是出厂默认。你可以在这里加上自己常看的来源、偏好的地区、想排除的类型——改完下次跑就按你的来。）$p$,
          'week', 1, 8, producer.task_next_run('week', 1, 8, now()))
  on conflict do nothing;
  return new;
end
$$;
