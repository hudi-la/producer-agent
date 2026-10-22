-- 0059: 「这个库里装的是示范数据还是真人的数据」——一个标记，外加一道守卫。
--
-- 为什么要有它：这个仓库要作为模板发布，示范内容用的是胡地的**公开**作品集
-- （见 docs/specs/2026-08-13-skeleton-and-flesh-design.md）。真数据当示范有两个
-- 好处（零成本、演示得出「起草的信知道你是谁」这件事），但代价是明确的：
-- 有人 fork 下来忘了换，Fairwind 会用他的名义讲胡地的作品。
--
-- 所以要一个标记，让「换成你自己的」从可选变成必经。
--
-- ⚠️ 默认 false 是本次动作的安全性质：
--    现有的库拿到这一列，值是 false，于是所有挂在它下面的新行为**一律不生效**。
--    正在跑的系统行为一个字节都不变。不是靠小心，是结构上碰不到。

alter table producer.profile
  add column if not exists is_demo boolean not null default false;

comment on column producer.profile.is_demo is
  'true = 这个库里是模板自带的示范内容（别人的作品集），起草会被挡下。'
  ' false = 有人声明过「这个库归我了」，示范种子从此再也碰不了它。';


-- ── 守卫：示范种子只对示范库生效 ──────────────────────────────────────
--
-- supabase/demo/ 里那几支种子含 truncate / delete —— 对着真人的库跑一遍，
-- 机会线连同全部往来历史当场清零。平时风险低（没人会去跑），但模板化会把
-- 「新人跑一遍种子」写进安装说明，那一刻这几条就成了随时会被触发的指令。
--
-- 判据用 is_demo 而不是「表是不是空的」：空表也可能是刚建好的真人库，而
-- is_demo = false 是一个**明确的、人写下的**声明。
--
-- 新克隆的库：profile 一行都没有 → exists(...) 为假 → 种子照跑，行为不变。
-- 胡地的库：  profile 有一行 is_demo = false → 抛错中止 → 一行都没删。
--
-- ⚠️ 种子必须整支跑在**一个事务**里，抛错才能把后面的 truncate 一起回滚。
--    Supabase SQL editor、MCP apply_migration、psql -1 都是这样跑的；
--    psql -f 不加 -1 不是 —— 别那么跑。
create or replace function producer.demo_guard() returns void
language plpgsql as $guard$
begin
  if exists (select 1 from producer.profile where coalesce(is_demo, false) = false) then
    raise exception using
      message = '拒绝执行示范种子：这个库里是真人的数据。',
      detail  = 'producer.profile.is_demo = false —— 有人声明过「这个库归我了」。'
                ' 这几支种子含 truncate，跑下去会清空机会线和全部往来历史。',
      hint    = '这是护栏，不是故障。真要重灌示范数据，先把 is_demo 改成 true。';
  end if;
end
$guard$;

comment on function producer.demo_guard() is
  '示范种子的护栏。每支 supabase/demo/*.sql 的第一条语句都是 select producer.demo_guard();';
