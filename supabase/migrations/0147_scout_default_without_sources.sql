-- Producer Agent — 出厂「每周找机会」的提示词不再带具体来源
--
-- 2026-09-25。0143 那版把作者自己的聚合源写进了每个人的默认任务。换成一段通用找法:
-- 从画像(常住地 / 媒介 / 身份 / 排除规则)出发去搜、点官方页核实。文字与 brain/scoutDefault.js 的 zh 一字不差。
-- 已经种下、还是 0143 老版原样的那些(带 {{画像}} 占位符 + 「【一】固定聚合源」那段)一并换掉;改过的不动。
-- 作者自己那条(画像手写、没有占位符)不在此列。

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


update producer.tasks set prompt = $p$你是这位艺术家的机会跟踪助理，每周跑一次：按下面的画像找适合 ta 的机会——驻地、资助、公开征集、群展、奖项——把新的加进关注表。造哪几张卡由系统按「够不够得着」决定，不用你挑。

== 画像（筛选标准就是这个，没写的别替 ta 假设）==
{{画像}}

== 怎么找 ==
- 用 WebSearch / WebFetch。从画像出发拟关键词：常住地 + 类型 + 年份（例如「<常住地> artist residency open call <年份>」）、媒介或创作方向 + grant / open call、ta 的身份能申请的资助。
- 每条都点进官方页核实：现在开不开放、真实截止、要什么材料。只有聚合站转载、找不到官方页的不算。
- 当前没开放但值得等的也报，注明预计开放时间。
- 触犯画像里「排除规则」的直接跳过；明显 vanity（高报名费 + 含糊奖项、要为领奖付钱、没有独立官网）放进 skipped 并写清原因。

（这一段是出厂默认。你可以在这里加上自己常看的来源、偏好的地区、想排除的类型——改完下次跑就按你的来。）$p$
 where type = 'scout_aggregators' and prompt like '%{{画像}}%' and prompt like '%【一】固定聚合源%';
