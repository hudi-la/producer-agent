-- Producer Agent — initial schema
-- Lives in its OWN `producer` schema inside the SHARED Supabase project.
-- Never touches `public` (card-writer / reading tables) — data-safe by construction.

create schema if not exists producer;

-- ── 画像 / artist profile ──────────────────────────────────────────────
-- Single row for self-use. jsonb `data` holds the scout's filter criteria
-- (ported from the existing Claude cron): location, visa, career stage,
-- directions, preferences, eligibility exclusion rules, etc.
create table if not exists producer.profile (
  id         uuid primary key default gen_random_uuid(),
  singleton  boolean not null default true,
  name       text,
  website    text,
  data       jsonb  not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint profile_one_row unique (singleton)
);

-- ── 作品库 / works ─────────────────────────────────────────────────────
-- Read from the artist's website (public, read-only mirror) OR added manually.
-- `box` = the private outreach layer the website can't hold
--   (why_now, reach_out, hidden_links, materials…). Owned & editable by the artist.
create table if not exists producer.works (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  medium     text,
  year       text,
  blurb      text,                                   -- one-line, from the site
  concern    text,                                   -- grouping key (see profile concerns)
  site_path  text,                                   -- e.g. #/echo-chamber-realms
  source     text not null default 'website',        -- website | manual
  box        jsonb not null default '{}'::jsonb,      -- the private layer
  sort       int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists works_concern_idx on producer.works (concern);

-- keep updated_at fresh
create or replace function producer.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists works_touch on producer.works;
create trigger works_touch before update on producer.works
  for each row execute function producer.touch_updated_at();

drop trigger if exists profile_touch on producer.profile;
create trigger profile_touch before update on producer.profile
  for each row execute function producer.touch_updated_at();

-- NOTE: RLS is intentionally deferred for the self-use first slice.
-- Before this is multi-user, enable RLS on producer.* and scope by an artist_id.
