-- brain/local/preamble.sql
-- 本地建库前先跑的一段。只在 PGlite 上跑,不进 supabase/migrations,不碰 producer schema。
-- 补的是 Supabase 才有的三样:三个角色(迁移里 grant 要用)、auth schema、auth.uid()。
-- 全部幂等:每次启动都跑一遍也没事。
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon;          end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role;  end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id         uuid primary key,
  email      text,
  created_at timestamptz not null default now()
);
-- 「现在登录的是谁」:brain 每次开库后 set_config 一次(PGlite 只有一个会话,设一次一直在)
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('fairwind.uid', true), '')::uuid $$;
-- 迁移记账
create schema if not exists producer_meta;
create table if not exists producer_meta.applied (
  filename   text primary key,
  applied_at timestamptz not null default now()
);
