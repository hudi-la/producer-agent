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
-- Supabase Storage 的两张表(0044 建桶、挂策略要用)。本地附件不走它们——
-- 字节落在 <数据目录>/files/(localdb.js)。这两张只是让那支迁移能过。
create schema if not exists storage;
create table if not exists storage.buckets (
  id              text primary key,
  name            text,
  public          boolean default false,
  file_size_limit bigint
);
create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text,
  name      text
);
-- storage.foldername(name):Supabase Storage 自带的函数,0153 的桶策略用它取路径第一段(= owner)。
-- 本地没有 Storage 服务,只需要这个函数**存在**,让那支迁移能建策略;桩的算法跟真的一致:
-- 按 '/' 切开、去掉最后一段(文件名)。PGlite 会话是超级用户,策略本身在本地不生效。
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
