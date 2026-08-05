-- 球在谁那边：待处理（该你动）/ 等回复（等对方）。
--
-- 为什么需要它：stage 说的是「这条线走到哪一格」，不是「现在该谁动」。
-- 一条 waiting 的线可能是你欠人家一封信，也可能是人家欠你——同一格，两种意思。
-- 外联死于跟进，而跟进的第一个问题永远是「球在谁手里」。
--
-- 自动推导（ball_auto，视图里算，前端不重复实现）：
--   ① 最后一条外部往来是谁说的 —— org 说的 → 该你动；artist 说的 → 等对方。
--      这是最可靠的信号，比 stage 准，因为它就是邮件线的真实状态。
--      ⚠️ 必须限定 kind='email'：你和渡的内部对话也是 role='artist'，
--         不限定的话「刚跟渡说了句话」会被误读成「已致信机构、在等回复」。
--   ② 没有外部往来 → 按 stage 推（自己手上的活 vs 已交出去的）
--   ③ next_touch_at 到期或过期 → 一律算「该你动」（到点了就是你该动，不管谁最后说话）
-- 手动覆盖（ball）优先于自动；置回 null 即恢复自动。

alter table producer.pursuits
  add column if not exists ball text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pursuits_ball_chk') then
    alter table producer.pursuits
      add constraint pursuits_ball_chk check (ball is null or ball in ('me','them'));
  end if;
end $$;

drop view if exists public.v_pa_pursuits;
create view public.v_pa_pursuits as
  select p.id, p.title, p.kind, p.org, p.location, p.url, p.funding, p.deadline,
         p.match_stars, p.why, p.notes, p.source, p.eligible, p.stage,
         p.work_id, p.task_id, p.created_at,
         p.next_touch_at, p.payoff, p.contact_id,
         w.title as work_title,
         c.name  as contact_name,
         c.role  as contact_role,
         p.ball,
         case
           -- ③ 到点了就是你该动，压过其他信号
           when p.next_touch_at is not null and p.next_touch_at <= current_date then 'me'
           -- ① 最后说话的人
           when last_ext.role = 'org'    then 'me'
           when last_ext.role = 'artist' then 'them'
           -- ② 没有外部往来时按阶段
           when p.stage in ('brief','proposed','pick_work','writing') then 'me'
           when p.stage in ('submitted','waiting')                    then 'them'
           else null                       -- won / declined / shelved：没球可打
         end as ball_auto
    from producer.pursuits p
    left join producer.works    w on w.id = p.work_id
    left join producer.contacts c on c.id = p.contact_id
    left join lateral (
      select m.role
        from producer.pursuit_messages m
       where m.pursuit_id = p.id
         and m.role in ('org','artist')
         and m.kind = 'email'               -- 只认真实对外通信；和渡的对话(kind='message')不算
       order by m.created_at desc
       limit 1
    ) last_ext on true;

grant select on public.v_pa_pursuits to anon, authenticated;

-- 写口：和 pa_set_stage 同构——只能改 ball，改不了别的。只给 service_role（在 brain/.env）。
create or replace function public.pa_set_ball(p_pursuit_id uuid, p_ball text)
returns jsonb
language plpgsql
security definer
set search_path = public, producer
as $$
declare updated producer.pursuits;
begin
  if p_ball is not null and p_ball not in ('me','them') then
    raise exception 'ball 只能是 me / them / null';
  end if;
  update producer.pursuits set ball = p_ball where id = p_pursuit_id returning * into updated;
  if not found then raise exception '没有这条机会线：%', p_pursuit_id; end if;
  return jsonb_build_object('id', updated.id, 'ball', updated.ball);
end $$;

revoke all on function public.pa_set_ball(uuid, text) from public, anon, authenticated;
grant execute on function public.pa_set_ball(uuid, text) to service_role;
