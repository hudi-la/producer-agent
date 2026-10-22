-- 「更新最新信息」的数据面：作废、提案、认领。
--
-- 三列三种意思，一列一种（0019 的规矩）：
--   next_action_void_at  这条待办什么时候作废的（作废 ≠ 做完，next_action_done_at 是做完）
--   next_action_void_by  因为哪封信作废的（指向 pursuit_messages，界面上点得回去）
--   next_action_by       这句待办谁写的：you | fairwind。「它提的」记号就认这一列，
--                        不拿文本前缀混在正文里——改文案要迁全库，前端还得字符串匹配。
--
-- 划掉不删掉：next_action 原文永远留着。你翻到卡上看得见「这条本来在，
-- 被这封信作废了」——不是它凭空没了（铁律：看不见 = 丢了）。

alter table producer.pursuits
  add column if not exists next_action_void_at timestamptz,
  add column if not exists next_action_void_by uuid references producer.pursuit_messages(id),
  add column if not exists next_action_by text not null default 'you'
    check (next_action_by in ('you', 'fairwind'));

comment on column producer.pursuits.next_action_void_at is '待办作废时间；作废≠做完，与 done_at 分开';
comment on column producer.pursuits.next_action_void_by is '因为哪封信作废（pursuit_messages.id）';
comment on column producer.pursuits.next_action_by is '这句待办谁写的：you | fairwind';

-- ── 读面：照抄 0023，多三列 ─────────────────────────
drop view if exists public.v_pa_pursuits;
create view public.v_pa_pursuits as
  select p.id, p.title, p.kind, p.org, p.location, p.url, p.funding, p.deadline,
         p.match_stars, p.why, p.notes, p.source, p.eligible, p.stage,
         p.work_id, p.task_id, p.created_at,
         p.next_touch_at, p.payoff, p.contact_id,
         p.opens_at, p.deadline_at, p.next_action, p.next_action_done_at, p.last_touch_at,
         p.next_action_void_at, p.next_action_void_by, p.next_action_by,
         p.jot,
         w.title as work_title,
         c.name  as contact_name,
         c.role  as contact_role,
         p.ball, p.ball_at,
         b.ball_auto,
         case when b.manual_holds then p.ball else b.ball_auto end as ball_eff
    from producer.pursuits p
    left join producer.works    w on w.id = p.work_id
    left join producer.contacts c on c.id = p.contact_id
    left join lateral (
      select m.role, m.created_at
        from producer.pursuit_messages m
       where m.pursuit_id = p.id
         and m.role in ('org','artist')
         and m.kind = 'email'
       order by m.created_at desc
       limit 1
    ) last_ext on true
    cross join lateral (
      select
        case
          when p.next_touch_at is not null and p.next_touch_at <= current_date then 'me'
          when last_ext.role = 'org'    then 'me'
          when last_ext.role = 'artist' then 'them'
          else null
        end as ball_auto,
        p.ball is not null
          and (
            p.ball_at is null
            or (
              (last_ext.created_at is null or last_ext.created_at <= p.ball_at)
              and (p.next_touch_at is null
                   or p.next_touch_at > current_date
                   or p.next_touch_at <= p.ball_at::date)
            )
          ) as manual_holds
    ) b;

grant select on public.v_pa_pursuits to anon, authenticated, service_role;

-- ── Fairwind 的两个新口子（只给 service_role，前端拿不到） ──────
-- 边界同 08-05：第一个参数是 p_pursuit_id，它被关在单线里。
-- 闸设在这儿而不是只在 prompt 里——prompt 会被忽略，数据库不会。

-- 作废：必须说出因为哪封信（p_msg_id 必填且必须是这条线上的消息）。
create or replace function public.pa_void_next_action(
  p_pursuit_id uuid, p_msg_id uuid, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public, producer as $$
declare v_ok boolean;
begin
  if p_msg_id is null then
    return jsonb_build_object('voided', false, 'reason', '没说因为哪封信，不作废');
  end if;
  select exists(select 1 from producer.pursuit_messages m
                 where m.id = p_msg_id and m.pursuit_id = p_pursuit_id) into v_ok;
  if not v_ok then
    return jsonb_build_object('voided', false, 'reason', '那条消息不在这条线上');
  end if;
  update producer.pursuits
     set next_action_void_at = now(),
         next_action_void_by = p_msg_id
   where id = p_pursuit_id
     and next_action is not null
     and next_action_done_at is null      -- 做完的不用作废
     and next_action_void_at is null;     -- 作废过的不重复作废
  if not found then
    return jsonb_build_object('voided', false, 'reason', '这条线没有可作废的待办');
  end if;
  return jsonb_build_object('voided', true);
end $$;

-- 提案：你写的待办（by=you 且没做完没作废）永不覆盖——这一条在库里卡死。
-- Fairwind 自己旧的提案可以被新提案顶掉（它改自己的话不算覆盖你）。
create or replace function public.pa_propose_next_action(
  p_pursuit_id uuid, p_action text, p_touch date default null
) returns jsonb
language plpgsql security definer set search_path = public, producer as $$
begin
  if p_action is null or btrim(p_action) = '' then
    return jsonb_build_object('written', false, 'reason', '空提案不写');
  end if;
  update producer.pursuits
     set next_action = btrim(p_action),
         next_action_by = 'fairwind',
         next_action_done_at = null,
         next_action_void_at = null,
         next_action_void_by = null,
         next_touch_at = coalesce(p_touch, next_touch_at)
   where id = p_pursuit_id
     and not (      -- 你的、活着的待办 → 拒绝
       next_action is not null
       and next_action_by = 'you'
       and next_action_done_at is null
       and next_action_void_at is null
     );
  if not found then
    return jsonb_build_object('written', false, 'reason', '你自己写的待办还活着，不覆盖');
  end if;
  return jsonb_build_object('written', true);
end $$;

-- 你认了它的提案：记号消失。前端直连（跟 pa_set_jot 同一档）。
create or replace function public.pa_accept_next_action(p_pursuit_id uuid)
returns void
language plpgsql security definer set search_path = public, producer as $$
begin
  update producer.pursuits
     set next_action_by = 'you'
   where id = p_pursuit_id
     and next_action_by = 'fairwind';
end $$;

-- 最小权限：Fairwind 的两个口子只有 service_role 够得着。
revoke all on function public.pa_void_next_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.pa_void_next_action(uuid, uuid, text) to service_role;
revoke all on function public.pa_propose_next_action(uuid, text, date) from public, anon, authenticated;
grant execute on function public.pa_propose_next_action(uuid, text, date) to service_role;
grant execute on function public.pa_accept_next_action(uuid) to anon, authenticated, service_role;
