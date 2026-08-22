-- Producer Agent — 脉搏只数真的动静：改了 0 行不算动过
--
-- 0111 挂的是光杆 statement 触发器，它的脾气是**语句跑过就算数，哪怕一行
-- 没改**。写 0111 的时候我自己就演示过：`update ... where false` 照样把 n
-- 拨了一格。当时没当回事，是错的——
--
-- brain 每 5 分钟一轮收信，`pa_mail_rule_pass` / `pa_link_replies` /
-- `pa_orphan_mail` 这些 RPC 里全是 update…where，信箱安静的时候它们
-- **每一条都改 0 行**。照 0111 那个挂法，一轮白拨好几次，一天上千次；
-- 而每拨一次，所有开着的标签页都要重拉 161 KB 的看板。省下来的钱又从
-- 这个口子漏回去了，而且漏得没有声音——页面看着一切正常。
--
-- 改法：用**过渡表**（transition table）问一句「这条语句到底动了行没有」，
-- 动了才拨。PG 的限制是一个带过渡表的触发器只能挂一种事件，所以拆成
-- 三个（insert / update / delete），过渡表一律叫 chg。
--
-- truncate 拿不到过渡表，单留一个光杆的——清表本来就是大动静，
-- 宁可多拨一次也不能漏。
--
-- 判据没变，仍然是「producer 下任何真实改动都拨得动它」：
-- 少数了的只有「压根没改成东西的那些语句」，那本来就不该算动静。

-- 真动了才拨。execute 而不是直接写 select：过渡表的名字要到触发时才存在，
-- 而且这一个函数要伺候好几十张表，plpgsql 缓存下来的计划会串味。
create or replace function producer.pulse_bump_if_changed()
returns trigger
language plpgsql security definer
set search_path = producer
as $$
declare hit boolean;
begin
  execute 'select exists (select 1 from chg)' into hit;
  if hit then update producer.pulse set n = n + 1, at = now() where id; end if;
  return null;
end
$$;

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'producer'
      and tablename not in ('pulse', 'mail_accounts', 'stage_backup_0015')
  loop
    -- 0111 那个光杆的，连同这次的，全先摘干净再挂 —— 重复跑这道迁移不该叠出两套
    execute format('drop trigger if exists t_pulse   on producer.%I', t);
    execute format('drop trigger if exists t_pulse_i on producer.%I', t);
    execute format('drop trigger if exists t_pulse_u on producer.%I', t);
    execute format('drop trigger if exists t_pulse_d on producer.%I', t);
    execute format('drop trigger if exists t_pulse_t on producer.%I', t);

    execute format(
      'create trigger t_pulse_i after insert on producer.%I
         referencing new table as chg for each statement
         execute function producer.pulse_bump_if_changed()', t);
    execute format(
      'create trigger t_pulse_u after update on producer.%I
         referencing new table as chg for each statement
         execute function producer.pulse_bump_if_changed()', t);
    execute format(
      'create trigger t_pulse_d after delete on producer.%I
         referencing old table as chg for each statement
         execute function producer.pulse_bump_if_changed()', t);
    -- 清表：过渡表这儿用不了，光杆的照挂
    execute format(
      'create trigger t_pulse_t after truncate on producer.%I
         for each statement execute function producer.pulse_bump()', t);
  end loop;
end
$$;
