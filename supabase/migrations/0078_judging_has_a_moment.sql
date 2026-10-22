-- Producer Agent — 判断得有执行点
--
-- 病：没有任何时刻会发生「重判」。写 next_touch_at 的 handleRefresh 是死代码
--     （refreshPursuit 只 import 没调用，全局同步走 /mail/sync 纯收信），
--     于是库里那几个日期是历史遗留，不是活的。0072 又加了 next_touch_why
--     这一列，同样没有任何东西写它。
--
-- 设计稿：docs/specs/2026-08-19-rejudge-design.md

-- ══ 一、移卡要留下时间戳 ═══════════════════════════════════════
--
-- 「移卡这件事情本身也是包括判断的」——你把 Stanford 移到「发出&提交」，
-- 那就是你说了「这件事我做完了」。可 pursuits 上没有任何一列记「阶段是
-- 什么时候变的」。
--
-- **不能拿 updated_at 顶替**：它任何一次 update 都会动，而重判本身就要写
-- next_touch_at —— 那会把自己变成脏的，下一轮再判，无限循环。
alter table producer.pursuits
  add column if not exists stage_at timestamptz;

comment on column producer.pursuits.stage_at is
  '阶段是什么时候变的。只由 pa_set_stage 写 —— 拿 updated_at 顶替会让重判把自己变脏';

-- 回填：没有历史，就退回建卡时间。宁可一开始全算脏（多判一轮），
-- 也不要一个假的「刚刚动过」。
update producer.pursuits set stage_at = created_at where stage_at is null;

-- ══ 二、pa_set_stage 顺手写上 ══════════════════════════════════
--
-- 整段重写（0025 的规矩）。**返回类型和抛错行为一个字不动**——
-- 改成 boolean 就得先 drop，而 drop 会连带 grant 一起没，静默改掉权限模型。
-- 全文只多了 stage_at = now() 这一处。
create or replace function public.pa_set_stage(p_pursuit_id uuid, p_stage text)
returns void
language plpgsql
security definer
set search_path to 'public', 'producer'
as $function$
begin
  if p_stage not in ('pending','matching','writing','sent','replying','won','paused') then
    raise exception 'bad stage: %', p_stage;
  end if;
  update producer.pursuits set stage = p_stage, stage_at = now() where id = p_pursuit_id;
  if not found then
    raise exception 'no pursuit: %', p_pursuit_id;
  end if;
end;
$function$;

-- ══ 三、水位：上次重判看到哪儿 ═════════════════════════════════
--
-- **不用队列，不用脏标记。** 队列会跟事实分叉——这个项目反复吃过这个亏
-- （pa_seen 在 localStorage 那次、过卡队列那次）。
--
-- 只记一个水位。脏不脏是**算**出来的：
--     脏 = 这个对象最后一件事的时间 > judged_upto
-- 水位漂了、判断中断了、迁移重跑了，下一次一算就知道。
create table if not exists producer.cue_judged (
  subject_kind text not null check (subject_kind in ('contact','pursuit')),
  subject_id   uuid not null,
  judged_upto  timestamptz not null,
  judged_at    timestamptz not null default now(),
  primary key (subject_kind, subject_id)
);

comment on table producer.cue_judged is
  '上次重判时看到的最后一件事发生在什么时候。脏不脏是算出来的，不是存的';

create or replace view public.v_pa_cue_judged as
  select subject_kind, subject_id, judged_upto, judged_at from producer.cue_judged;
grant select on public.v_pa_cue_judged to anon, authenticated, service_role;

create or replace function public.pa_mark_judged(
  p_kind text, p_id uuid, p_upto timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public, producer
as $$
begin
  if p_upto is null then return false; end if;   -- 没看到任何事就别推水位
  insert into producer.cue_judged (subject_kind, subject_id, judged_upto)
       values (p_kind, p_id, p_upto)
  on conflict (subject_kind, subject_id) do update
     set judged_upto = greatest(producer.cue_judged.judged_upto, excluded.judged_upto),
         judged_at = now();
  return true;
end $$;

grant execute on function public.pa_mark_judged(text, uuid, timestamptz)
  to anon, authenticated, service_role;

-- ══ 四、写下一个时间点：日期和出处必须同时给 ═══════════════════
--
-- 这是第一条病的直接对策，从库这一层堵死：**缺一个就两个都不写**。
-- 「你定的日子到了（8/17）」那句话之所以能出现，就是因为日期可以单独存在。
create or replace function public.pa_set_next_touch(
  p_kind text, p_id uuid, p_at date, p_why text)
returns boolean
language plpgsql
security definer
set search_path = public, producer
as $$
declare w text := nullif(btrim(coalesce(p_why, '')), '');
begin
  -- 清空是允许的：两个都给 null = 这条约定作废了
  if p_at is null and w is null then
    if p_kind = 'pursuit' then
      update producer.pursuits set next_touch_at = null, next_touch_why = null where id = p_id;
    else
      update producer.contacts set next_touch_at = null, next_touch_why = null where id = p_id;
    end if;
    return found;
  end if;

  -- 只给一个 —— 拒绝。说不出为什么的日期，到点了没人知道该干什么；
  -- 而没有日期的理由，永远不会响。
  if p_at is null or w is null then
    raise exception '日期和出处必须同时给（日期 %，出处 %）', p_at, coalesce(w, '（空）');
  end if;

  if p_kind = 'pursuit' then
    update producer.pursuits set next_touch_at = p_at, next_touch_why = w where id = p_id;
  else
    update producer.contacts set next_touch_at = p_at, next_touch_why = w where id = p_id;
  end if;
  return found;
end $$;

grant execute on function public.pa_set_next_touch(text, uuid, date, text)
  to anon, authenticated, service_role;
