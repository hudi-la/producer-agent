-- ⚠️ 示范内容，不是系统的一部分。整个 demo/ 装的是一位艺术家的公开作品集，
--    fork 下来请换成你自己的 —— 见 demo/README.md。
--
-- 下面这行是护栏（migration 0059）。这个库里要是真人的数据，整支在这里中止，
-- 一行都不会删。种子必须整支跑在一个事务里，护栏才拦得住后面的 truncate。
select producer.demo_guard();

-- 造卡任务清单。**只有第一条是定时跑的**（有提示词、有排期，脑子到点会跑它，见 0119/0120）；
-- 其余几条后台不连任何东西：有战报的是当时手动跑出来的历史，最后几条还没接。
-- 提示词跟 demo/scout-prompt.md 是同一段字，改一边记得改另一边。
-- 注意：truncate tasks 会 cascade 到 pursuits(task_id FK)——要连 pursuits 一起重灌，见 0004。
truncate producer.tasks cascade;

insert into producer.tasks (name, type, enabled, schedule, sort, last_result, prompt, run_every, run_weekday, run_hour, next_run_at) values
  ('每周找机会', 'scout_aggregators', true, 'weekly', 10, '上周复查 20 行 · 进表 4 个 · 造卡 2 张',
   $p$你是 HuDi 的艺术机会跟踪助理，每周例行跑一次。这一步是**往关注表里加行**，不是直接造卡——造哪几张卡由系统后面按「够不够得着」定。

== HuDi 画像（筛选标准）==
- 常住 LA + 旧金山湾区，美国 O-1 签证，emerging（CalArts 背景，2023 起活跃展出），中英双语，背景物理 + 计算机。
- 方向：装置为主（微缩 + 日常物、沉浸式、参与式 / 观众即共同作者）；AI / 新媒体（技术作为材料与批评对象）；社会介入；母题「被看见、被爱、被理解」。
- 高匹配信号：装置 / 沉浸式 / 场域特定 / 参与式 / 社会介入 / 技术批评 / AI / 新媒体 / 亲密与依恋 / 在地。
- 不推：纯绘画或传统媒介专项、纯表演舞蹈、纯炫技科技展、要求长期脱离 LA/SF 且无资助。
- 偏好带资助，接受少 / 无资助，可一定程度考虑收费 residency；可国际旅行。
- 【排除规则】限定美国公民 / 绿卡、或需当地工作权的 → 照报，但 eligible=false（会标成资格搁置留着，等身份变化）。
- 【关注规则】高匹配但当前未开放 → 照报，status 填 closed，opens_at 填预计开放日，notes 以「🟡 关注 · 下轮预计 …」开头。

== 来源 ==
两条线都走一遍。

【一】固定聚合源，扫最新内容（用 WebFetch / WebSearch；动态页面抓不到正文就用 WebSearch 兜底，或跳过该源继续）：
- https://creative-capital.org/artist-resources/artist-opportunities/ （该页较重，可能需 WebSearch 兜底）
- https://www.thisiscolossal.com/category/opportunities/ （Colossal 每月更新，先找到当月那篇 "Opportunities: Open Calls, Residencies, and Grants for Artists"）
- https://www.transartists.org/en/transartists-calls
- https://artinfoland.com/opportunities
- https://newmediacaucus.org/opportunities/
- https://jobs.chronicle.com/jobs/art/california/

【二】搜索，找网上新冒出来的（用 WebSearch，各搜一到两轮，优先近 30 天内发布的）：
- "open call" installation art 2026 OR 2027 deadline
- "call for artists" "new media" OR "media art" OR AI residency 2026
- "socially engaged" art residency OR grant "open call" 2026
- artist residency funded international "open call" 2026 participatory OR immersive
- "Los Angeles" OR "Bay Area" artist "open call" OR grant 2026

搜到的每一条都**点进官方页核实**：是不是真的在开放、真实截止、要什么材料。只有聚合站二手转载、找不到官方页的不算数。

== 筛选 ==
- 按画像判断匹配度（★★★ / ★★）；不匹配的丢弃，不用报。
- 合法性辨别：跳过明显的 vanity（高报名费 + 含糊奖项）、要求为领奖付钱、无独立官网等可疑项——这些放进 skipped，写清原因。
- 表里已有的（下面会给名单）不要再报。
- 截止日期以官方页面为准，聚合站上的常是上一届残留。$p$, 'week', 1, 8, producer.task_next_run('week', 1, 8, now()));

insert into producer.tasks (name, type, enabled, schedule, sort, last_result) values
  ('你自己丢的',         'manual',                 true,  null,     20, null),
  ('盯梢机构',           'institution_monitor',    false, null,     30, '未接'),
  ('邮箱进来的机会',     'email_watch',            false, null,     40, '未接'),
  ('关系降温提醒',       'relationship_followup',  false, null,     50, '未接');

-- 之后重跑 0004（会重灌 pursuits），并把 task_id 按 source 回填。
