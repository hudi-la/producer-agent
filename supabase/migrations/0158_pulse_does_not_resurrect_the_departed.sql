-- 0158 · 删账号时 pulse 不给这个正在消失的人补行(2026-10-02,公司的库上第一次删测试账号就撞上)
--
-- 0154 的 pulse_touch:行没有就补一行。删 auth.users 时级联删掉他的所有行,每一条删除都
-- 拨一下脉搏——而他的 pulse 行已经被级联删掉了,补行等于往一个外键指向「不存在的人」的表里插,
-- 语句结束时 pulse_owner_fkey 报错,整个删除回滚。PGlite 上没测到,因为本机从不删账号。
--
-- 修:只给**还在**的账号补行。级联删除时父行已经不在,exists 为假,跳过补行;
-- 后面那句 update 对一个不存在的行什么也不做。正常拨脉搏的路一个字不变。
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
  elsif exists (select 1 from auth.users u where u.id = p_owner) then
    insert into producer.pulse (owner, n) values (p_owner, 0)
      on conflict (owner) where owner is not null do nothing;
  end if;
  execute format('update producer.pulse set n = n + 1, at = now()%s where owner is not distinct from $1',
                 coalesce(', ' || cols, ''))
    using p_owner;
end
$$;
