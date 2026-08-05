-- Memory layer: 机会线 (pursuits) + 往来历史 (pursuit_messages).
-- This is where the producer's memory lives. Every brain turn reads a pursuit +
-- its messages + the chosen work's box, and writes results back here.

create table if not exists producer.pursuits (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  org         text,
  location    text,
  url         text,
  funding     text,
  deadline    text,                                   -- free text ("约 6 周" / "2026-09-30")
  match_stars int,                                    -- 2 | 3
  why         text,                                   -- one-line fit reason (scout)
  source      text not null default 'scout',          -- scout | manual
  eligible    boolean not null default true,          -- false → 待身份变化 hold
  stage       text not null default 'proposed',       -- proposed|brief|pick_work|writing|submitted|waiting|won|shelved
  work_id     uuid references producer.works(id) on delete set null,  -- chosen work (null until 挑作品)
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists pursuits_stage_idx on producer.pursuits (stage);

create table if not exists producer.pursuit_messages (
  id          uuid primary key default gen_random_uuid(),
  pursuit_id  uuid not null references producer.pursuits(id) on delete cascade,
  role        text not null,                          -- producer | artist | system | note
  kind        text not null default 'message',        -- message | brief | draft | decision
  content     text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists pursuit_messages_pid_idx on producer.pursuit_messages (pursuit_id, created_at);

drop trigger if exists pursuits_touch on producer.pursuits;
create trigger pursuits_touch before update on producer.pursuits
  for each row execute function producer.touch_updated_at();
