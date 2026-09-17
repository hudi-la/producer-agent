-- Producer Agent — 一个库,很多艺术家:隔离只有一道门
--
-- workshop-edition 分支(2026-08-24)。设计稿 docs/specs/2026-08-24-many-artists-one-database.md。
-- 0001 的最后一行埋的那颗种子,今天发芽:
--   "Before this is multi-user, enable RLS on producer.* and scope by an artist_id."
--
-- ── 刀法:不改 89 个函数体,改它们的**身份** ────────────────────
--
-- 本来的方案是给 89 个 pa_* 函数逐个加「当前登录的是谁」的过滤——
-- 每改一个都是一次留洞的机会,而且洞是静默的。这里走另一条路:
--
--   1. 每张表加 owner 列,行级权限(RLS)只认 owner = auth.uid()
--   2. 所有 pa_* 函数从 security definer 翻成 **security invoker**
--   3. 所有 v_pa_* 视图打开 **security_invoker = true**
--
-- 于是「什么算你的行」只在一个地方定义(表上的 policy),函数和视图
-- 都以调用者的身份跑,自动被同一道门管住。漂亮的副作用:代码里所有
-- 「取那唯一一行」的写法(profile/voice 的 limit 1、where singleton),
-- 在 RLS 下自动变成「取**你的**那一行」——函数体一个字都不用改,
-- 单人系统的假设整体平移成了多人系统。
--
-- ── owner 为什么可空 ──────────────────────────────────────────
--
-- 迁移和种子在 postgres 身份下跑,auth.uid() 是 null——owner 若 not null,
-- 从零重放在 0113/0116 那些带 insert 的迁移上会当场炸。可空的安全性质:
-- owner is null 的行对任何登录用户都**不可见**(null ≠ 任何 uid),
-- 不泄露,只是无主。合并回个人版时,他注册后跑一次认领(owner 回填),
-- 那之后可以再补 not null。
--
-- ── 已知的功能性缺口(不是安全缺口)────────────────────────────
--
-- contacts / contact_emails / org_mailboxes / mail_accounts 的唯一索引
-- 还是全局的(lower(email))。两个学员认识同一个策展人时,后插的会撞
-- 唯一索引——报错,不泄密(RLS 挡着读)。修法是把这几个索引改成
-- (owner, lower(email)) 并同步改对应 upsert 函数的 on conflict 目标,
-- 单独一刀,见设计稿。mail_headers 等 gmail_message_id 主键保持全局:
-- Gmail id 跨信箱撞车的概率是天文数字,撞上也是报错不是泄露。
--
-- ── 新表的规矩 ────────────────────────────────────────────────
--
-- 这支用目录循环盖到**今天存在的**每张表。以后新建的表要自带
-- owner + policy;忘了的话,隔离测试(scripts/isolation-test.mjs)是
-- 按目录扫的,会当场红给你看。

-- 一、owner + 索引 + RLS + policy:producer 里除 pulse_areas 外的每张表
--    (pulse_areas 是「区块 → 视图名」的全局配置,不是谁的数据)
do $$
declare t record;
begin
  for t in select c.relname from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'producer' and c.relkind = 'r'
              and c.relname <> 'pulse_areas'
  loop
    execute format('alter table producer.%I add column if not exists owner uuid default auth.uid() references auth.users(id) on delete cascade', t.relname);
    execute format('create index if not exists %I on producer.%I (owner)', t.relname || '_owner_idx', t.relname);
    execute format('alter table producer.%I enable row level security', t.relname);
    execute format('drop policy if exists own_rows on producer.%I', t.relname);
    execute format('create policy own_rows on producer.%I for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid())', t.relname);
  end loop;
end $$;

-- pulse_areas:所有登录用户可读,谁都不可写(只有迁移动它)
alter table producer.pulse_areas enable row level security;
drop policy if exists read_all on producer.pulse_areas;
create policy read_all on producer.pulse_areas for select to authenticated using (true);

-- 二、profile / voice:从「全库一行」变成「每人一行」
alter table producer.profile drop constraint if exists profile_one_row;
alter table producer.voice   drop constraint if exists voice_one_row;
create unique index if not exists profile_one_per_owner on producer.profile (owner) where owner is not null;
create unique index if not exists voice_one_per_owner   on producer.voice   (owner) where owner is not null;

-- 三、登录用户能进 producer(RLS 在表上把行管住;anon 什么都没有)
grant usage on schema producer to authenticated;
grant select, insert, update, delete on all tables in schema producer to authenticated;

-- 四、89 个 pa_* 函数:definer → invoker;anon 一律收走
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'pa\_%'
  loop
    execute format('alter function %s security invoker', f.sig);
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- 五、30 个 v_pa_* 视图:以调用者身份跑;anon 一律收走
do $$
declare v record;
begin
  for v in select c.relname from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'v\_pa\_%'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
    execute format('revoke all on public.%I from public, anon', v.relname);
    execute format('grant select on public.%I to authenticated, service_role', v.relname);
  end loop;
end $$;

-- 六、注册即入住:新用户自动拿到自己的 profile 和 voice 行
--    (security definer:这个触发器在 auth 系统的身份下跑,得越过 RLS 写进去)
create or replace function producer.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = producer, public
as $$
begin
  insert into producer.profile (owner) values (new.id) on conflict do nothing;
  insert into producer.voice   (owner) values (new.id) on conflict do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function producer.handle_new_user();
