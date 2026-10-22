-- 0157 · 回得来:我名下所有行,一包导出、一包导回(设计稿 2026-10-02 D16、第十一节)
--
-- ── 为什么要两个函数,而不是让脑子逐表读 ────────────────────────
-- 托管下脑子拿的是那个人的 JWT,走 PostgREST;producer 不是暴露出去的 schema,
-- 基表直接读不到,v_pa_* 视图又各有各的裁剪(去掉长文本、拼别的表),拿它们当备份会丢字段。
-- 所以备份在库里做:pa_backup_export 把 producer 里**每张带 owner 列的表**整行读成 jsonb,
-- pa_backup_import 原样写回。表名不写死,从目录里现查——以后新建的表自动进包。
--
-- ── 谁的行 ──────────────────────────────────────────────────────
-- 两支都是 security invoker,函数体里**不写 auth.uid()**(0150 的规矩,PGlite 上函数体直呼
-- auth.uid() 会 permission denied):读靠 RLS 只给自己的行;写时把 owner 从列清单里拿掉,
-- 列默认值 auth.uid() 盖上,RLS 的 with check 再核一遍。于是备份包里的 owner 字段只是个记号,
-- 导到哪个账号就归谁——「公司撤了,学员拿着 zip 装本机版点恢复」靠的就是这一条。
--
-- ── 不进包的两张 ──────────────────────────────────────────────────
-- member_settings:里面是 key 和 MCP 令牌。备份会落到 Google Drive、会在学员之间传,
--   作者每晚替人跑一份(第十一节)——key 不该跟着走(D18 作者看不见内容)。设置重新填一遍就是。
-- pulse:按人的计数器,导入时触发器自己会拨,导回来反而重。
--
-- ── 外键和环 ────────────────────────────────────────────────────
-- 表之间有外键,还有一个环:pursuits.next_action_void_by → pursuit_messages,pursuit_messages.pursuit_id → pursuits。
-- 一张表一条 insert 的话,谁先谁后都过不了。外键检查是在**一条语句结束时**做的,所以把所有表的
-- insert 放进同一条语句的 with 子句里(每张表一个 CTE),哪张先写无所谓,语句结束时全体一起核。
-- 清空同理:所有 delete 一条语句。同一张表内部的自引用(contacts.merged_into 之类)自然也不用管。
-- backup_table_order 只是把表按依赖排个顺(被引用的在前),让导出的包、返回的计数稳定好读;有环就字典序兜底。
--
-- ── 写回的规矩 ──────────────────────────────────────────────────
-- · 只写备份里真出现过的列(表后来加的列按默认值来;备份里多出来的、表上没有的键 jsonb_populate_recordset 自己忽略)
-- · 主键撞了 do nothing:不带 p_wipe 时是「合并」,已有的留着;要「跟备份一模一样」就带 p_wipe
--   (主键是全库唯一的:别人账号里还留着同一行时,这一行也会被当成「已有」跳过——行数照实报)
-- · p_wipe 先把**我名下**每张表清空(RLS 限定),再写——整支函数一个事务,中间出错全部回滚

create or replace function producer.backup_table_order()
returns text[]
language plpgsql
stable
security invoker
set search_path = producer, public
as $$
declare
  todo text[];
  ordered text[] := '{}';
  t text;
  progressed boolean;
begin
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into todo
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'owner' and not a.attisdropped
   where n.nspname = 'producer' and c.relkind = 'r'
     and c.relname not in ('member_settings', 'pulse');
  while cardinality(todo) > 0 loop
    progressed := false;
    foreach t in array todo loop
      if not exists (
        select 1 from pg_constraint k
          join pg_class tc on tc.oid = k.conrelid
          join pg_class rc on rc.oid = k.confrelid
          join pg_namespace rn on rn.oid = rc.relnamespace
         where k.contype = 'f' and tc.relname = t and tc.relnamespace = rc.relnamespace
           and rn.nspname = 'producer' and rc.relname <> t and rc.relname::text = any(todo))
      then
        ordered := ordered || t;
        todo := array_remove(todo, t);
        progressed := true;
      end if;
    end loop;
    if not progressed then ordered := ordered || todo; exit; end if;   -- 环:剩下的照字典序
  end loop;
  return ordered;
end
$$;

revoke all on function producer.backup_table_order() from public, anon;
grant execute on function producer.backup_table_order() to authenticated, service_role;

-- 导出:{ 表名: [整行…] }。行里带 owner(只是记号,导入时不看)。
create or replace function public.pa_backup_export()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, producer
as $$
declare
  out jsonb := '{}'::jsonb;
  t text;
  rows jsonb;
begin
  foreach t in array producer.backup_table_order() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from producer.%I x', t) into rows;
    out := out || jsonb_build_object(t, rows);
  end loop;
  return out;
end
$$;

revoke all on function public.pa_backup_export() from public, anon;
grant execute on function public.pa_backup_export() to authenticated, service_role;

-- 导入:p = 导出的那个对象;p_wipe = 先清我名下的行。返回 { tables: {表: 写进几行}, wiped: {表: 删了几行} }。
create or replace function public.pa_backup_import(p jsonb, p_wipe boolean default false)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, producer
as $$
declare
  order_ text[];
  t text;
  cols text;
  ctes text[] := '{}';
  outs text[] := '{}';
  counts jsonb := '{}'::jsonb;
  wiped  jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception '备份内容不是一个对象'; end if;
  order_ := producer.backup_table_order();

  if p_wipe then
    foreach t in array order_ loop
      ctes := ctes || format('d_%s as (delete from producer.%I returning 1)', t, t);
      outs := outs || format('%L, (select count(*) from d_%s)', t, t);
    end loop;
    execute format('with %s select jsonb_build_object(%s)', array_to_string(ctes, ', '), array_to_string(outs, ', ')) into wiped;
    ctes := '{}'; outs := '{}';
  end if;

  foreach t in array order_ loop
    if not (p ? t) or jsonb_typeof(p -> t) <> 'array' or jsonb_array_length(p -> t) = 0 then continue; end if;
    -- 列清单 = 表上的列 ∩ 备份行里出现过的键,去掉 owner(让默认值盖)
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a
     where a.attrelid = format('producer.%I', t)::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attname <> 'owner'
       and a.attname in (select distinct k from jsonb_array_elements(p -> t) r(value), jsonb_object_keys(r.value) k);
    if cols is null then continue; end if;
    ctes := ctes || format('i_%s as (insert into producer.%I (%s) select %s from jsonb_populate_recordset(null::producer.%I, $1 -> %L) on conflict do nothing returning 1)', t, t, cols, cols, t, t);
    outs := outs || format('%L, (select count(*) from i_%s)', t, t);
  end loop;
  if cardinality(ctes) > 0 then
    execute format('with %s select jsonb_build_object(%s)', array_to_string(ctes, ', '), array_to_string(outs, ', ')) into counts using p;
  end if;

  return jsonb_build_object('tables', counts, 'wiped', wiped);
end
$$;

revoke all on function public.pa_backup_import(jsonb, boolean) from public, anon;
grant execute on function public.pa_backup_import(jsonb, boolean) to authenticated, service_role;
