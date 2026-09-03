-- ⚠️ 示范内容，不是系统的一部分。整个 demo/ 装的是一位艺术家的公开作品集，
--    fork 下来请换成你自己的 —— 见 demo/README.md。
--
-- 下面这行是护栏（migration 0059）。这个库里要是真人的数据，整支在这里中止，
-- 一行都不会删。种子必须整支跑在一个事务里，护栏才拦得住后面的 truncate。
select producer.demo_guard();

-- 造卡任务清单。两条 scout 带提示词和排期（0119）；其它留位可加。
-- 提示词跟 demo/scout-prompt.md、demo/opencall-prompt.md 是同一段字，改一边记得改另一边。
-- 注意：truncate tasks 会 cascade 到 pursuits(task_id FK)——要连 pursuits 一起重灌，见 0004。
truncate producer.tasks cascade;

insert into producer.tasks (name, type, enabled, schedule, sort, last_result, prompt, run_every, run_weekday, run_hour, next_run_at) values
  ('每周找聚合源', 'scout_aggregators', true, 'weekly', 10, '上周新增 3 张',
   $p$你是 HuDi 的艺术机会跟踪助理，每周例行跑一次：扫聚合源，按画像筛，把通过的报成卡。

== HuDi 画像（筛选标准）==
- 常住 LA + 旧金山湾区，美国 O-1 签证，emerging，中英双语，背景物理 + 计算机。
- 方向：装置为主（微缩 + 日常物、沉浸式、参与式 / 观众即共同作者）；AI / 新媒体（技术作为材料与批评对象）；社会介入；母题「被看见、被爱、被理解」。
- 偏好带资助，接受少 / 无资助，可一定程度考虑收费 residency；可国际旅行。
- 【排除规则】限定美国公民 / 绿卡、或需当地工作权的 → 照报，但 eligible=false（卡上会标「资格搁置」，等身份变化）。
- 【关注规则】高匹配但当前未开放 → 照报，notes 以「🟡 关注 · 下轮预计 …」开头，opens_at 填预计开放日。

== 来源 ==
扫这些聚合源的最新内容（用 WebFetch / WebSearch；动态页面抓不到正文就用 WebSearch 兜底，或跳过该源继续）：
- https://creative-capital.org/artist-resources/artist-opportunities/ （该页较重，可能需 WebSearch 兜底）
- https://www.thisiscolossal.com/category/opportunities/ （Colossal 每月更新，先找到当月那篇 "Opportunities: Open Calls, Residencies, and Grants for Artists"）
- https://www.transartists.org/en/transartists-calls
- https://artinfoland.com/opportunities
- https://newmediacaucus.org/opportunities/
- https://jobs.chronicle.com/jobs/art/california/
- 可补充 WebSearch："artist open call grant prize 2026 deadline installation new media socially engaged"

== 筛选 ==
对每个候选：
- 按画像判断匹配度（★★★ / ★★）；不匹配的丢弃，不用报。
- 合法性辨别：跳过明显的 vanity（高报名费 + 含糊奖项）、要求为领奖付钱、无独立官网等可疑项——这些放进 skipped，写清原因。
- 库里已有的（下面会给名单）不要再报。
- 截止日期以官方页面为准，聚合站上的常是上一届残留；点进官方页核实过再报。
- 每周最多报 5 个，宁缺毋滥。$p$, 'week', 1, 8, producer.task_next_run('week', 1, 8, now())),
  ('每周找 Open Call', 'scout_search', true, 'weekly', 12, null,
   $p$你是 HuDi 的艺术机会跟踪助理，每周例行跑一次：用 WebSearch 找近期发布的 open call / 驻地 / grant，按画像筛，把通过的报成卡。这条跟「聚合源」那条分工：那条扫固定的几个站，这条搜网上新冒出来的。

== HuDi 画像（筛选标准）==
- 常住 LA + 旧金山湾区，美国 O-1 签证，emerging，中英双语，背景物理 + 计算机。
- 方向：装置为主（微缩 + 日常物、沉浸式、参与式 / 观众即共同作者）；AI / 新媒体（技术作为材料与批评对象）；社会介入；母题「被看见、被爱、被理解」。
- 偏好带资助，接受少 / 无资助，可一定程度考虑收费 residency；可国际旅行。
- 【排除规则】限定美国公民 / 绿卡、或需当地工作权的 → 照报，但 eligible=false（卡上会标「资格搁置」，等身份变化）。
- 【关注规则】高匹配但当前未开放 → 照报，notes 以「🟡 关注 · 下轮预计 …」开头，opens_at 填预计开放日。

== 来源 ==
用 WebSearch 搜这几组，各搜一到两轮，优先近 30 天内发布的：
- "open call" installation art 2026 OR 2027 deadline
- "call for artists" "new media" OR "media art" OR AI residency 2026
- "socially engaged" art residency OR grant "open call" 2026
- artist residency funded international "open call" 2026 participatory OR immersive
- "Los Angeles" OR "Bay Area" artist "open call" OR grant 2026
搜到的每一条都点进官方页核实：是不是真的在开放、真实截止、要什么材料。只有聚合站二手转载、找不到官方页的不算数。

== 筛选 ==
- 按画像判断匹配度（★★★ / ★★）；不匹配的丢弃，不用报。
- 合法性辨别：跳过明显的 vanity（高报名费 + 含糊奖项）、要求为领奖付钱、无独立官网等可疑项——这些放进 skipped，写清原因。
- 库里已有的（下面会给名单）不要再报。
- 每周最多报 5 个，宁缺毋滥。$p$, 'week', 1, 9, producer.task_next_run('week', 1, 9, now()));

insert into producer.tasks (name, type, enabled, schedule, sort, last_result) values
  ('你自己丢的',         'manual',                 true,  null,     20, null),
  ('盯梢机构',           'institution_monitor',    false, null,     30, '未接'),
  ('邮箱进来的机会',     'email_watch',            false, null,     40, '未接'),
  ('关系降温提醒',       'relationship_followup',  false, null,     50, '未接');

-- 之后重跑 0004（会重灌 pursuits），并把 task_id 按 source 回填。
