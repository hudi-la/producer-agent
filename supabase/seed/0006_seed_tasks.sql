-- 造卡任务清单。scout 只是第一条；其它留位可加。
-- 注意：truncate tasks 会 cascade 到 pursuits(task_id FK)——要连 pursuits 一起重灌，见 0004。
truncate producer.tasks cascade;

insert into producer.tasks (name, type, enabled, schedule, sort, last_result) values
  ('聚合源 scout',       'scout_aggregators',      true,  'weekly', 10, '上周新增 3 张'),
  ('你自己丢的',         'manual',                 true,  null,     20, null),
  ('盯梢机构',           'institution_monitor',    false, null,     30, '未接'),
  ('邮箱进来的机会',     'email_watch',            false, null,     40, '未接'),
  ('关系降温提醒',       'relationship_followup',  false, null,     50, '未接');

-- 之后重跑 0004（会重灌 pursuits），并把 task_id 按 source 回填。
