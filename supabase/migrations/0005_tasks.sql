-- 造卡任务层：机会从一组 tasks 流进「待批准」。scout 只是其中一条。
create table if not exists producer.tasks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null,   -- scout_aggregators | manual | institution_monitor | email_watch | relationship_followup
  enabled     boolean not null default true,
  schedule    text,            -- 'weekly' | cron 表达式 | null(事件/手动)
  config      jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  last_result text,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 每张机会线记住是哪条任务造的
alter table producer.pursuits add column if not exists task_id uuid references producer.tasks(id) on delete set null;

drop trigger if exists tasks_touch on producer.tasks;
create trigger tasks_touch before update on producer.tasks
  for each row execute function producer.touch_updated_at();
