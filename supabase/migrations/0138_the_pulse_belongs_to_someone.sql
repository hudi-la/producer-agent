-- Producer Agent — 脉搏归人:每人自己的一根
--
-- workshop-edition(2026-08-24)。0118 把每张表的行都归了人,但 pulse 是
-- 个例外里的例外:0111 把它设计成**全库一行**(id 恒为 true 的主键),
-- pulse_bump_if_changed 是 security definer、拨的就是那一行。
--
-- 多租户下这是活动信号的串扰:A 一动,B 的界面也以为有动静该刷新。
-- 不泄内容,但泄「有人在动」,而且让脉搏在每个人眼里都变成噪音。
--
-- 改法:
--   · 拆掉「只能有一行」的主键,一人一行(owner 唯一,部分索引)
--   · bump 按 auth.uid() 找自己那行,没有就当场发一行
--   · uid 为 null 的路(service_role 直写、迁移)拨 owner is null 那行——
--     那根「无主脉搏」谁也看不见,但保留它是为了老路径不报错
--   · 读那头(v_pa_pulse)不用动:0118 已把视图翻成 invoker,RLS 自动
--     让每人只看见自己那根

alter table producer.pulse drop constraint if exists pulse_pkey;
create unique index if not exists pulse_one_per_owner on producer.pulse (owner) where owner is not null;
create unique index if not exists pulse_the_ownerless on producer.pulse ((true)) where owner is null;

create or replace function producer.pulse_bump_if_changed()
returns trigger
language plpgsql security definer
set search_path = producer, public
as $$
declare hit boolean; uid uuid := auth.uid();
begin
  execute 'select exists (select 1 from chg)' into hit;
  if hit then
    if uid is null then
      update producer.pulse set n = n + 1, at = now() where owner is null;
      if not found then insert into producer.pulse (n) values (1); end if;
    else
      update producer.pulse set n = n + 1, at = now() where owner = uid;
      if not found then insert into producer.pulse (n, owner) values (1, uid); end if;
    end if;
  end if;
  return null;
end
$$;

-- 清表那条走的还是老 pulse_bump(过渡表用不了),同样归人
create or replace function producer.pulse_bump()
returns trigger
language plpgsql security definer
set search_path = producer, public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    update producer.pulse set n = n + 1, at = now() where owner is null;
    if not found then insert into producer.pulse (n) values (1); end if;
  else
    update producer.pulse set n = n + 1, at = now() where owner = uid;
    if not found then insert into producer.pulse (n, owner) values (1, uid); end if;
  end if;
  return null;
end
$$;
