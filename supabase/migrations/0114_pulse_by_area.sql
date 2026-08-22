-- Producer Agent — 改动计数器按区拆开：只重下真正受影响的那一块
--
-- 他提的（2026-08-21）。0111 那个计数器只有一个数字，它只知道「有东西被写了」，
-- 不知道「哪一块变了」——于是给一个邮箱地址下判断，也会让整个看板重新下载。
--
-- 他的原话：一行多列，分开数不同的表。这个判断是对的，而且几乎不花钱——
-- HTTP 响应头 912 字节一个字节不变，返回的内容从 10 字节变成约 45 字节，
-- 但网页从此能知道该重下哪一块。
--
-- ══ 归属不手写，从视图依赖关系推出来 ═══════════════════════════
--
-- 「哪张表属于哪一块」如果我手打一张清单，它迟早跟视图的真实定义分叉，
-- 而分叉的症状是**某一栏该刷新却不刷新，并且不报错**——你要过几天才发现。
-- 所以这儿只登记「区 → 视图」（pulse_areas），表的归属由 pulse_wire()
-- 递归穿透视图算出来。以后视图改了，重跑一次 pulse_wire() 就重新对上。
--
-- ══ 漏配怎么保证不静默 ═══════════════════════════════════════
--
-- 两道闸，一道在这儿一道在前端：
--  · 这儿：推导不出归属的表，归到 misc（没人订阅），并且 pulse_wire()
--    把完整的「表 → 区」对照表当返回值吐出来，随时可以查账。
--  · 前端：onPulse 用了没注册过的区名，立刻抛错——漏配在第一次打开
--    那个页面时就炸出来，不会变成几周后才发现的「这一栏怎么不动」。
--
-- 落进 misc 的表（address_verdicts、mail_label_audit、contact_emails、
-- letter_verdicts、message_tags、cue_*、tasks、profile、contact_orgs）逐张核过：
-- 它们对应的页面现在本来就不轮询（打开时加载一次、你操作后重载），所以不倒退。

-- ── 一、区 → 视图 的注册表 ────────────────────────────────────
create table if not exists producer.pulse_areas (
  area      text not null,
  view_name text not null,
  primary key (area, view_name)
);

insert into producer.pulse_areas (area, view_name) values
  ('board',  'public.v_pa_pursuits'),        -- 项目争取那一页的卡片
  ('thread', 'public.v_pa_pursuit_thread'),  -- 卡片详情里的信和对话
  ('deliv',  'public.v_pa_deliverables'),    -- 详情右栏的产出
  ('deliv',  'public.v_pa_attachments')      -- 详情右栏的附件
on conflict do nothing;

-- ── 二、一个视图最终落在哪些真实的表上（穿透中间所有视图）────────
create or replace function producer.base_tables_of(p_view regclass)
returns table (tbl text)
language sql stable as $$
  with recursive g as (
    select p_view as oid
    union
    select c.oid
      from g
      join pg_rewrite r on r.ev_class = g.oid
      join pg_depend  d on d.objid = r.oid and d.classid = 'pg_rewrite'::regclass
      join pg_class   c on c.oid = d.refobjid
     where c.relkind in ('r','v') and c.oid <> g.oid
  )
  select distinct c.relname::text
    from g
    join pg_class c on c.oid = g.oid
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'r' and n.nspname = 'producer'
$$;

-- ── 三、拨动：只在真有行变动时，且只拨这张表所属的那几列 ──────────
create or replace function producer.pulse_bump_areas()
returns trigger
language plpgsql security definer
set search_path = producer
as $$
declare hit boolean; cols text;
begin
  if TG_OP = 'TRUNCATE' then
    hit := true;            -- 清表拿不到过渡表；清表本来就是大动静，宁可多拨
  else
    -- 0112 那条规矩：改了 0 行不算动过
    execute 'select exists (select 1 from chg)' into hit;
  end if;
  if not hit then return null; end if;

  select string_agg(format('%I = %I + 1', a, a), ', ') into cols from unnest(TG_ARGV) a;
  execute format('update producer.pulse set n = n + 1, at = now()%s where id',
                 case when cols is null then '' else ', ' || cols end);
  return null;
end
$$;

-- ── 四、按注册表重建全部触发器。返回完整对照表，好查账 ────────────
create or replace function producer.pulse_wire()
returns text
language plpgsql
as $$
declare t text; a text; areas text[]; arglist text; report text := '';
begin
  -- 每个区都得有一列；新加区时不用手动 alter
  for a in select distinct area from producer.pulse_areas
           union select 'misc'
  loop
    execute format('alter table producer.pulse add column if not exists %I bigint not null default 0', a);
  end loop;

  for t in select tablename from pg_tables
            where schemaname = 'producer'
              and tablename not in ('pulse', 'pulse_areas', 'mail_accounts', 'stage_backup_0015')
            order by tablename
  loop
    select coalesce(array_agg(distinct pa.area), array[]::text[]) into areas
      from producer.pulse_areas pa
     where exists (select 1 from producer.base_tables_of(pa.view_name::regclass) b where b.tbl = t);

    if array_length(areas, 1) is null then areas := array['misc']; end if;
    select string_agg(quote_literal(x), ', ') into arglist from unnest(areas) x;

    -- 0111 / 0112 挂过的一并摘掉，重复跑这道迁移不该叠出两套
    execute format('drop trigger if exists t_pulse   on producer.%I', t);
    execute format('drop trigger if exists t_pulse_i on producer.%I', t);
    execute format('drop trigger if exists t_pulse_u on producer.%I', t);
    execute format('drop trigger if exists t_pulse_d on producer.%I', t);
    execute format('drop trigger if exists t_pulse_t on producer.%I', t);

    execute format('create trigger t_pulse_i after insert on producer.%I
                      referencing new table as chg for each statement
                      execute function producer.pulse_bump_areas(%s)', t, arglist);
    execute format('create trigger t_pulse_u after update on producer.%I
                      referencing new table as chg for each statement
                      execute function producer.pulse_bump_areas(%s)', t, arglist);
    execute format('create trigger t_pulse_d after delete on producer.%I
                      referencing old table as chg for each statement
                      execute function producer.pulse_bump_areas(%s)', t, arglist);
    execute format('create trigger t_pulse_t after truncate on producer.%I
                      for each statement
                      execute function producer.pulse_bump_areas(%s)', t, arglist);

    report := report || t || ' → ' || array_to_string(areas, '+') || E'\n';
  end loop;
  return report;
end
$$;

select producer.pulse_wire();

-- ── 五、前端的读面 ───────────────────────────────────────────
-- n 留着：它是「有任何东西变了」，查账和以后加订阅方时都用得上。
-- 先 drop：create or replace 只能在末尾追加列，这儿是在 n 和 at 中间插几列。
drop view if exists public.v_pa_pulse;
create view public.v_pa_pulse as
  select n, board, thread, deliv, misc, at from producer.pulse;

grant select on public.v_pa_pulse to anon, authenticated, service_role;
