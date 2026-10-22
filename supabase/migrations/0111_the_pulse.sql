-- Producer Agent — 脉搏：库里动没动，一个数说话
--
-- 起因（2026-08-21）：免费档 5 GB/月的下行流量被打爆，库被锁。
-- 账查下来，钱全花在「反复重拉没变的东西」上——前端三个 setInterval
-- 每 3/5/8 秒把整包数据（连邮件原文 body_raw）重新拉一遍，一天 4.5 GB。
-- 全文见 docs/specs/2026-08-21-egress-diet.md。
--
-- 方案不改「轮询」这个形状，改每一跳的价钱：轮询的对象从「整包数据」
-- 换成这儿的一行两列（几十字节）。n 变了，前端才去真拉。
--
-- **为什么敢说不漏**：producer 下每张表都挂 statement 级触发器，任何
-- insert / update / delete / truncate 都拨 n。不是挑「我觉得会变的表」——
-- 挑就会漏，漏了就是「界面上安静地缺一块」，那是这个系统最不许犯的错。
--
-- 有意不挂的只有两张，理由都写死在这儿：
--   mail_accounts     —— 收信游标（0045 的 pa_mail_cursor）每 5 分钟必写，
--                        跟着它跳等于每 5 分钟白拉一轮。它面上可见的字段
--                        （地址、label、backfilled_at）几乎从不变；真变了，
--                        也总伴随 mail_headers 的写入，脉搏照样会动。
--   stage_backup_0015 —— 0015 留的历史备份，死表。
--
-- ⚠️ 以后建新表，记得回来补一句同样的 create trigger（照抄下面 do 块里
-- 那两行 execute 就行）。漏了的症状：那张表的改动不会自己出现在页面上，
-- 要等别的表动了才捎带出来。

create table if not exists producer.pulse (
  id boolean     primary key default true check (id),   -- 单行表：id 恒为 true
  n  bigint      not null default 0,
  at timestamptz not null default now()
);

insert into producer.pulse (id) values (true) on conflict (id) do nothing;

-- security definer：写 producer 表的路子不止一条（service_role 直写、
-- anon 走 security definer 的 RPC），谁写都得拨得动这一行。
create or replace function producer.pulse_bump()
returns trigger
language plpgsql security definer
set search_path = producer
as $$
begin
  update producer.pulse set n = n + 1, at = now() where id;
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
    execute format('drop trigger if exists t_pulse on producer.%I', t);
    execute format(
      'create trigger t_pulse
         after insert or update or delete or truncate on producer.%I
         for each statement execute function producer.pulse_bump()', t);
  end loop;
end
$$;

-- 前端的读面。跟别的 v_pa_* 一个姿势。
create or replace view public.v_pa_pulse as
  select n, at from producer.pulse;

grant select on public.v_pa_pulse to anon, authenticated, service_role;
