-- 把「下一步该干什么」这个筐拆开，并让它可以被勾掉。
--
-- 病根：next_touch_at 一个字段被拿来装四种意思，所以卡上那句话经常是错的——
--   Lightning Fund「8 天后跟进」其实是「人家 8 天后才开放」
--   Web Residency 3 天后截止，最急的一张，却什么都不显示
--   Book Arts「该跟进了」但你早回过邮件了
--   CultureHub「该跟进了」，实际要交的是签字表 + 宣传素材，不是发信
-- 一句听起来很确定、其实没依据的话——和之前球权从 stage 猜是同一个错误。
--
-- 拆法：一个字段只装一种意思
--   opens_at       什么时候开放
--   deadline       截止原文（不动，"spring 2027" 这种要保留）
--   deadline_at    截止的可算日期（解析不出就留空）—— 倒计时和以后「按截止」筛选靠它
--   next_touch_at  收窄回原意：没有截止的线，你定的「该主动碰一下」的日子
--   next_action    下一步具体做什么（"交签字表 + 宣传素材"）
--
-- 勾掉 ≠ 删掉：next_action 原文留着，另存 done_at。卡面不再显示（做完了），
-- 详情页仍看得到「✓ …… · 8月4日完成」。这条线上你做过什么，是有历史的。

alter table producer.pursuits
  add column if not exists opens_at            date,
  add column if not exists deadline_at         date,
  add column if not exists next_action         text,
  add column if not exists next_action_done_at timestamptz,
  add column if not exists last_touch_at       date;   -- 「碰过了」勾掉时记这天

comment on column producer.pursuits.deadline    is '截止原文，可能是"spring 2027"这种非日期';
comment on column producer.pursuits.deadline_at is '截止的可算日期；解析不出留空';
comment on column producer.pursuits.next_touch_at is '只表示「该主动碰一下」的日子（无截止的线专用）';

-- 快到期的卡要天天查，给它一个索引
create index if not exists pursuits_deadline_at_idx on producer.pursuits (deadline_at)
  where deadline_at is not null;

-- ── 读面 ───────────────────────────────────────────────────────
drop view if exists public.v_pa_pursuits;
create view public.v_pa_pursuits as
  select p.id, p.title, p.kind, p.org, p.location, p.url, p.funding, p.deadline,
         p.match_stars, p.why, p.notes, p.source, p.eligible, p.stage,
         p.work_id, p.task_id, p.created_at,
         p.next_touch_at, p.payoff, p.contact_id,
         p.opens_at, p.deadline_at, p.next_action, p.next_action_done_at, p.last_touch_at,
         w.title as work_title,
         c.name  as contact_name,
         c.role  as contact_role,
         p.ball,
         case
           when p.next_touch_at is not null and p.next_touch_at <= current_date then 'me'
           when last_ext.role = 'org'    then 'me'
           when last_ext.role = 'artist' then 'them'
           else null
         end as ball_auto
    from producer.pursuits p
    left join producer.works    w on w.id = p.work_id
    left join producer.contacts c on c.id = p.contact_id
    left join lateral (
      select m.role
        from producer.pursuit_messages m
       where m.pursuit_id = p.id
         and m.role in ('org','artist')
         and m.kind = 'email'
       order by m.created_at desc
       limit 1
    ) last_ext on true;

grant select on public.v_pa_pursuits to anon, authenticated, service_role;

-- ── 写口：勾掉 / 取消勾 ────────────────────────────────────────
-- 浏览器直连（和 pa_set_stage 同构）：security definer，能改的列写死在函数里。
create or replace function public.pa_set_action_done(p_pursuit_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'producer'
as $function$
begin
  -- 勾掉只写时间戳，next_action 原文一个字不动 —— 取消勾还能回来
  update producer.pursuits
     set next_action_done_at = case when p_done then now() else null end
   where id = p_pursuit_id;
  if not found then raise exception 'no pursuit: %', p_pursuit_id; end if;
end;
$function$;

-- 「碰过了」：记下你哪天碰的，并把待碰日清掉。
-- 注意这里确实丢掉了原来的 next_touch_at —— 但它的信息量（你本该在某天碰）
-- 已经被「你在今天碰了」取代，后者严格更有用。没做撤销。
create or replace function public.pa_mark_touched(p_pursuit_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'producer'
as $function$
begin
  update producer.pursuits
     set last_touch_at = current_date, next_touch_at = null
   where id = p_pursuit_id;
  if not found then raise exception 'no pursuit: %', p_pursuit_id; end if;
end;
$function$;

revoke all on function public.pa_set_action_done(uuid, boolean) from public;
revoke all on function public.pa_mark_touched(uuid) from public;
grant execute on function public.pa_set_action_done(uuid, boolean) to anon, authenticated, service_role;
grant execute on function public.pa_mark_touched(uuid) to anon, authenticated, service_role;

-- ── Fairwind 回填：多收两个日期 ────────────────────────────────
-- 加参数等于新建一个重载，所以先把旧的四参版本删掉，免得两个并存。
-- 旧定义已存档在 0019 的提交信息里；行为不变，只是多了 opens_at / deadline_at。
drop function if exists public.pa_set_fields(uuid, text, text, boolean);
create function public.pa_set_fields(
  p_pursuit_id  uuid,
  p_url         text    default null,
  p_deadline    text    default null,
  p_eligible    boolean default null,
  p_opens_at    date    default null,
  p_deadline_at date    default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'producer'
as $function$
begin
  update producer.pursuits set
    url         = coalesce(nullif(p_url, ''), url),
    deadline    = coalesce(nullif(p_deadline, ''), deadline),
    eligible    = coalesce(p_eligible, eligible),
    opens_at    = coalesce(p_opens_at, opens_at),
    deadline_at = coalesce(p_deadline_at, deadline_at)
  where id = p_pursuit_id;
  if not found then raise exception 'no pursuit: %', p_pursuit_id; end if;
end;
$function$;

revoke all on function public.pa_set_fields(uuid, text, text, boolean, date, date) from public;
grant execute on function public.pa_set_fields(uuid, text, text, boolean, date, date) to service_role;
