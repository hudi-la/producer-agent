-- Producer Agent — 脉搏真的归人了:谁的行动了,只拨谁的那根
--
-- hosted-fairwind(2026-10-02),设计稿 docs/specs/2026-10-02-hosted-fairwind-design.md D12。
--
-- ── 0138 写好了,但没接上 ──────────────────────────────────────
-- 0138 把 pulse 从「全库一行」改成「一人一行」,也重写了 pulse_bump /
-- pulse_bump_if_changed 按 auth.uid() 找自己那行。可是从 0115 起,所有
-- 表上挂的触发器调的是 **pulse_bump_areas**(按区计数的那个),0128 又重跑过
-- pulse_wire 把每张表都指向它——0138 改的两个函数从那时起就没有任何触发器
-- 调过。而 pulse_bump_areas 还是 0115 的身体:security definer、
-- `update producer.pulse … where id`——id 对每一行都是 true,于是**所有人**
-- 的脉搏一起跳。A 存一条作品,B 的看板也重拉一次。不泄内容,但泄「有人在动」,
-- 而且在每个人眼里脉搏都成了噪音(0138 的头注写的就是这个病)。
--
-- ── 改法 ────────────────────────────────────────────────────────
-- · 主人从**过渡表里的 owner 列**读,不从 auth.uid() 猜:脑子拿 service_role
--   替某个学员写的时候 uid 是 null,但行上的 owner 是对的。一条语句碰到几个人
--   的行(迁移、全库修复)就拨几根。
-- · 没有 owner 列的表(以后谁忘了 0137 的规矩)、行全无主(迁移在 postgres 身份
--   下跑)→ 退回 auth.uid();uid 也空 → 拨那根谁也看不见的无主脉搏(0138 留的)。
-- · 区的语义不变:TG_ARGV 里还是 pulse_wire 推出来的那几列,前端 v_pa_pulse
--   读 n / board / thread / deliv / tasks / pool,一列不改。
-- · 注册即有自己的一根:单独一个 after insert on auth.users 触发器,
--   **不动 producer.handle_new_user**(那支归 profile / voice / scout 任务管)。
--   已有用户这儿补行——不然第一次 bump 之前 v_pa_pulse 是空的,
--   前端 maybeSingle 读到 null 就当「还没对过表」,头一跳永远叫不出来。
-- · 重跑 pulse_wire:0128 之后建的表(contact_seen / voice / studio_messages,
--   以及 0150 / 0151 的两张)一直没挂脉搏,这次一并挂上。
-- · 0138 那两个没人调的函数删掉:pulse_touch 是唯一一处「拨一根」的写法。
--   drop 会在还有触发器指着它们时报错——那正是该报的。

-- ── 一、拨一根:某人、某几区。行没有就当场发一行 ──────────────────
create or replace function producer.pulse_touch(p_owner uuid, p_areas text[])
returns void
language plpgsql security definer
set search_path = producer
as $$
declare cols text;
begin
  select string_agg(format('%I = %I + 1', a, a), ', ') into cols from unnest(p_areas) a;
  if p_owner is null then
    if not exists (select 1 from producer.pulse where owner is null) then
      insert into producer.pulse (owner, n) values (null, 0);
    end if;
  else
    insert into producer.pulse (owner, n) values (p_owner, 0)
      on conflict (owner) where owner is not null do nothing;
  end if;
  execute format('update producer.pulse set n = n + 1, at = now()%s where owner is not distinct from $1',
                 coalesce(', ' || cols, ''))
    using p_owner;
end
$$;

-- ── 二、触发器本体:签名不变,pulse_wire 挂的触发器自动用上新身体 ──────
create or replace function producer.pulse_bump_areas()
returns trigger
language plpgsql security definer
set search_path = producer, public
as $$
declare owners uuid[]; o uuid; hit boolean; has_owner boolean;
begin
  if TG_OP = 'TRUNCATE' then
    -- 清表拿不到过渡表,主人只能问 uid;清表本来就是大动静,宁可多拨
    perform producer.pulse_touch(auth.uid(), TG_ARGV);
    return null;
  end if;

  -- 0112 那条规矩:改了 0 行不算动过(execute:过渡表名到触发时才存在)
  execute 'select exists (select 1 from chg)' into hit;
  if not hit then return null; end if;

  select exists (select 1 from pg_attribute
                  where attrelid = TG_RELID and attname = 'owner' and not attisdropped)
    into has_owner;
  if has_owner then
    execute 'select array_agg(distinct owner) from chg where owner is not null' into owners;
  end if;
  if owners is null then owners := array[auth.uid()]; end if;

  foreach o in array owners loop
    perform producer.pulse_touch(o, TG_ARGV);
  end loop;
  return null;
end
$$;

-- ── 三、注册即有自己的一根(独立触发器,不碰 handle_new_user)────────
create or replace function producer.handle_new_user_pulse()
returns trigger
language plpgsql
security definer
set search_path = producer, public
as $$
begin
  insert into producer.pulse (owner, n) values (new.id, 0)
    on conflict (owner) where owner is not null do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created_pulse on auth.users;
create trigger on_auth_user_created_pulse
  after insert on auth.users
  for each row execute function producer.handle_new_user_pulse();

-- 已经注册的人补上
insert into producer.pulse (owner, n)
select u.id, 0 from auth.users u
 where not exists (select 1 from producer.pulse p where p.owner = u.id);

-- ── 四、0128 之后建的表一并挂上;0138 的两个死函数清掉 ──────────────
select producer.pulse_wire();

drop function if exists producer.pulse_bump();
drop function if exists producer.pulse_bump_if_changed();
