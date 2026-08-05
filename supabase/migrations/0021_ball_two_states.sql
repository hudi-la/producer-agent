-- 球权只有两个标：待处理 / 等回复。没有第三个叫「自动」的东西。
--
-- 原来详情页给了三个按钮：自动 / 待处理 / 等回复。这是把「谁来判断」当成一个
-- 你要操作的对象摆出来了——可你要回答的问题从来只有一个：球在谁那边。
-- Fairwind 自己贴一个标，你觉得贴错了就直接改掉，这就够了。
--
-- 撤掉「自动」按钮之后冒出一个新问题：你手改的标什么时候失效？
-- 一直钉住不行——你今天标了「等回复」，明天机构真回信了，卡上还写着等回复，
-- 那是一句看着很确定、其实已经过期的话（和 0017 撤掉 stage 猜球权是同一个错误）。
--
-- 定的规矩：你的修改只管到下一件真事发生为止。
--   手改之后没有新信号 → 听你的
--   来了新信号（新的对外通信 / 跟进日到了）→ 听 Fairwind 的
-- 所以要记一笔「你什么时候改的」（ball_at），拿它跟信号的时间比。
--
-- 读面多出一列 ball_eff：球到底在谁那边，一个答案。
-- ball / ball_auto 两列留着（前端不再用），因为出问题时你得看得出这个答案是怎么来的。

alter table producer.pursuits
  add column if not exists ball_at timestamptz;

comment on column producer.pursuits.ball    is '你手动贴的标；null = 没手动改过';
comment on column producer.pursuits.ball_at is '你哪一刻改的；比这之后发生的信号会盖过你的修改';

-- 已经手动钉过的老卡（库里 2 张）：没有「什么时候改的」这个记录，
-- 拿 updated_at 当近似。偏晚一点是安全的方向——最多多钉一会儿，不会凭空翻标。
update producer.pursuits
   set ball_at = updated_at
 where ball is not null and ball_at is null;

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
         p.ball, p.ball_at,
         b.ball_auto,
         -- 前端只读这一列
         case when b.manual_holds then p.ball else b.ball_auto end as ball_eff
    from producer.pursuits p
    left join producer.works    w on w.id = p.work_id
    left join producer.contacts c on c.id = p.contact_id
    left join lateral (
      select m.role, m.created_at
        from producer.pursuit_messages m
       where m.pursuit_id = p.id
         and m.role in ('org','artist')
         and m.kind = 'email'               -- 只认真实对外通信；和 Fairwind 的对话(kind='message')不算
       order by m.created_at desc
       limit 1
    ) last_ext on true
    cross join lateral (
      select
        case
          -- ③ 跟进日到了就是你该动，压过其他信号
          when p.next_touch_at is not null and p.next_touch_at <= current_date then 'me'
          -- ① 最后一封对外通信是谁发的
          when last_ext.role = 'org'    then 'me'
          when last_ext.role = 'artist' then 'them'
          -- 没有信号就别猜（0017：宁可不说，也不猜）
          else null
        end as ball_auto,
        -- 你手改的标还作数吗：没有比 ball_at 更新的信号，就作数
        p.ball is not null
          and (
            p.ball_at is null                       -- 兜底：来路不明的手动值，按老行为钉住
            or (
              -- 对外通信：改标之后又来过信，就不作数了
              (last_ext.created_at is null or last_ext.created_at <= p.ball_at)
              -- 跟进日：改标之后才到期的，也不作数
              and (p.next_touch_at is null
                   or p.next_touch_at > current_date
                   or p.next_touch_at <= p.ball_at::date)
            )
          ) as manual_holds
    ) b;

grant select on public.v_pa_pursuits to anon, authenticated, service_role;

-- ── 写口 ──────────────────────────────────────────────────────
-- 改一次标就盖一次时间戳；置回 null（交还自动）连时间戳一起清掉。
create or replace function public.pa_set_ball(p_pursuit_id uuid, p_ball text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'producer'
as $function$
declare updated producer.pursuits;
begin
  if p_ball is not null and p_ball not in ('me','them') then
    raise exception 'ball 只能是 me / them / null';
  end if;
  update producer.pursuits
     set ball    = p_ball,
         ball_at = case when p_ball is null then null else now() end
   where id = p_pursuit_id
   returning * into updated;
  if not found then raise exception '没有这条机会线：%', p_pursuit_id; end if;
  return jsonb_build_object('id', updated.id, 'ball', updated.ball, 'ball_at', updated.ball_at);
end;
$function$;

-- 0013 只开给了 service_role，可前端是浏览器直连改的标（和 pa_set_stage 同构）。
-- 线上早就手动补过这条 grant，迁移文件一直漏着——在这儿补齐，新库照样能用。
revoke all on function public.pa_set_ball(uuid, text) from public;
grant execute on function public.pa_set_ball(uuid, text) to anon, authenticated, service_role;
