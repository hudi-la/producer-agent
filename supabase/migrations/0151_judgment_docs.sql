-- Producer Agent — 判据文档进库(托管版 D7)
--
-- 2026-10-02,托管的 Fairwind。判据(「要不要回」「等多久」那几篇)一直是脑子旁边的
-- 文件,一台机器一份。一个脑子伺候所有人之后,它们得跟人走:producer.judgment_docs,
-- 主键 (owner, name),一人一套。judgments.js 的 lint / 拼接 / 回退逻辑不动,只多一个
-- 「从行加载」的入口;设置页里编辑的还是同一份界面。
--
-- 函数体里不写 auth.uid():跟 0140 / 0150 一个规矩,invoker + RLS 把行限定在自己名下,
-- owner 由列默认值盖上。
-- 0137 之后重定义 pa_* 的迁移不得写 security definer——这支全是 invoker;anon 一律不授。

create table if not exists producer.judgment_docs (
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  body       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (owner, name)
);

alter table producer.judgment_docs enable row level security;
drop policy if exists own_rows on producer.judgment_docs;
create policy own_rows on producer.judgment_docs
  for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

revoke all on producer.judgment_docs from public, anon;
grant select, insert, update, delete on producer.judgment_docs to authenticated, service_role;

-- 我的全部判据,按名字排
create or replace function public.pa_judgment_docs()
returns table (name text, body text, updated_at timestamptz)
language sql
stable
security invoker
set search_path = public, producer
as $$
  select d.name, d.body, d.updated_at
    from producer.judgment_docs d
   order by d.name
$$;
revoke all on function public.pa_judgment_docs() from public, anon;
grant execute on function public.pa_judgment_docs() to authenticated, service_role;

-- 写一篇(同名覆盖)
create or replace function public.pa_set_judgment_doc(p_name text, p_body text)
returns void
language plpgsql
security invoker
set search_path = public, producer
as $$
declare n text;
begin
  n := btrim(coalesce(p_name, ''));
  if n = '' then raise exception '判据得有个名字'; end if;
  insert into producer.judgment_docs (name, body)
  values (n, coalesce(p_body, ''))
  on conflict (owner, name) do update
     set body = excluded.body, updated_at = now();
end
$$;
revoke all on function public.pa_set_judgment_doc(text, text) from public, anon;
grant execute on function public.pa_set_judgment_doc(text, text) to authenticated, service_role;

-- 删一篇(没有就没有,不报错)
create or replace function public.pa_drop_judgment_doc(p_name text)
returns void
language sql
security invoker
set search_path = public, producer
as $$
  delete from producer.judgment_docs d
   where d.name = btrim(coalesce(p_name, ''))
$$;
revoke all on function public.pa_drop_judgment_doc(text) from public, anon;
grant execute on function public.pa_drop_judgment_doc(text) to authenticated, service_role;
