// 胡地的造卡任务清单 —— 哪几条开着、上次跑出什么。
// **这是示范内容。** 类型本身（TASK_DESC）是骨架，在 src/data/schema.js。
//
// 注：'agency_scout'（找模特经纪）是胡地特有的一条线，留着是因为它演示了
// 「一个卡点长出一类任务」这件事本身 —— 见 demo/README.md。

export const TASKS_SEED = [
  { id: 'scout', name: '聚合源 scout', type: 'scout_aggregators', enabled: true, schedule: 'weekly', last_result: '上周新增 3 张' },
  { id: 'agency', name: '找模特经纪 · 湾区 + 南加州（第一批）', type: 'agency_scout', enabled: true, schedule: '手动', last_result: '2026-08-06 手动跑了一轮：核实 7 家，另有 4 家查了没建卡（域名易主 / 抓不到），已留档' },
  { id: 'manual', name: '你自己丢的', type: 'manual', enabled: true, schedule: null, last_result: null },
  { id: 'monitor', name: '盯梢机构', type: 'institution_monitor', enabled: false, schedule: null, last_result: '未接' },
  { id: 'email', name: '邮箱进来的机会', type: 'email_watch', enabled: false, schedule: null, last_result: '未接' },
  { id: 'followup', name: '关系降温提醒', type: 'relationship_followup', enabled: false, schedule: null, last_result: '未接' },
]
