-- Producer Agent — 机会池：那张 Excel 搬进库
-- 设计稿：docs/specs/2026-09-03-opportunity-pool-design.md
--
-- 他的持续关注列表一直是盘上那个 Excel（82 行），Fairwind 看板上「持续关注」那一列
-- 只有 11 张，是它的一个零头。这一刀把整张表搬进来。
--
-- ══ 为什么是新表，不是 stage='watch' 的卡 ═══════════════════════
--
-- 他的原话：「不要放太多卡在那里」。池子会长到几百行，而一张卡背后拖着一整套机器 ——
-- 状态机、收信、归属、通知、已读、球权、产出。几百张 watch 卡会把看板、🔔、
-- 判断循环全部撑爆，而那些行根本没有任何往来可判。
--
-- 所以分层：**opportunities 是「世上有这么个机会」这个事实，pursuits 是「我在争取它」这条线。**
-- 池子里的一行被「捡出来」才变成卡（pa_pick_opportunity），从此归卡管。
--
-- ══ 存量一个不动 ═══════════════════════════════════════════════
-- 看板上现有 11 张 watch 卡、14 张 paused 卡原地不动。这道迁移不 update 任何一张 pursuit。
-- 变的只是「新的未开放机会往哪去」。

create table if not exists producer.opportunities (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  org         text,
  kind        text,
  location    text,
  funding     text,
  url         text,
  deadline    text,                       -- 原话，"spring 2027" / "rolling" 照抄
  deadline_at date,
  opens_at    date,
  -- 上次查的时候开着没有。unknown = 还没查过，不是「查过但没结论」
  status      text not null default 'unknown',
  fit_stars   int,                        -- 3 | 2，方向契不契合
  eligible    boolean not null default true,   -- 身份能不能申
  -- 够得着吗：以他现在的阶段。unknown = 往届名单没查到，**不是**降级
  reach          text,
  reach_why      text,
  reach_evidence text,                    -- 往届名单里查到了谁、那人当年什么履历
  reach_url      text,                    -- 往届名单那一页
  reach_at       timestamptz,             -- 判过一次就够，300 天后才重判
  why         text,                       -- 方向为什么合，中文一句
  notes       text,
  source      text not null default 'scout',
  task_id     uuid references producer.tasks(id)   on delete set null,
  pursuit_id  uuid references producer.pursuits(id) on delete set null,
  picked_at   timestamptz,
  dropped_at  timestamptz,
  dropped_why text,
  checked_at  timestamptz,
  check_note  text,
  noted_round date,                       -- 最近一次被标成「这一轮开着的」
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint opp_status_chk check (status in ('open', 'closed', 'unknown')),
  constraint opp_reach_chk  check (reach is null or reach in ('realistic', 'stretch', 'longshot', 'unknown')),
  constraint opp_stars_chk  check (fit_stars is null or fit_stars between 1 and 3)
);

comment on table producer.opportunities is
  '机会池 = 他那张 Excel。一行 = 世上有这么个机会。捡出来才变成卡（pursuits）。';
comment on column producer.opportunities.status is
  '上次查的时候开着没有。unknown = 还没查过';
comment on column producer.opportunities.reach is
  '以他现在的阶段够不够得着。unknown = 往届名单没查到，存疑不降级——绝不许编一份名单出来';
comment on column producer.opportunities.reach_evidence is
  '判据的凭证：往届名单里查到了谁、那人当年什么履历。没有凭证的 reach 不算数';

-- 去重靠标题（忽略大小写和首尾空白）。链接另有一个非唯一索引，upsert 时两头都对。
create unique index if not exists opportunities_title_key
  on producer.opportunities (lower(btrim(title)));
create index if not exists opportunities_url_idx
  on producer.opportunities (lower(rtrim(btrim(coalesce(url, '')), '/')))
  where url is not null;
create index if not exists opportunities_live_idx
  on producer.opportunities (status, fit_stars)
  where dropped_at is null and pursuit_id is null;

drop trigger if exists opportunities_touch on producer.opportunities;
create trigger opportunities_touch before update on producer.opportunities
  for each row execute function producer.touch_updated_at();

-- ── 脑子的口 ──────────────────────────────────────────────────

-- 进池子。**只填空，从不覆盖。**
--
-- 一个字段一个写者，这是这张表能同时被三步写而不打架的全部原因：
--   · upsert（发现那一步）只写空着的格
--   · pa_opp_checked 是 status / 日期 的唯一写者
--   · pa_opp_reach   是 reach 那几列的唯一写者
-- 不这么切的话，第二步会把第三步刚判出来的结论覆盖掉，而且没有任何迹象。
create or replace function public.pa_upsert_opportunity(
  p_title       text,
  p_org         text    default null,
  p_kind        text    default null,
  p_location    text    default null,
  p_funding     text    default null,
  p_url         text    default null,
  p_deadline    text    default null,
  p_deadline_at date    default null,
  p_opens_at    date    default null,
  p_status      text    default null,
  p_fit_stars   int     default null,
  p_eligible    boolean default null,
  p_why         text    default null,
  p_notes       text    default null,
  p_source      text    default 'scout',
  p_task_id     uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, producer
as $$
declare
  t_title text := btrim(p_title);
  u text := lower(rtrim(btrim(coalesce(p_url, '')), '/'));
  hit uuid;
  r producer.opportunities;
begin
  if coalesce(t_title, '') = '' then raise exception '进池子得有标题'; end if;

  -- 先看池子里有没有（标题或链接）
  select id into hit from producer.opportunities
   where lower(btrim(title)) = lower(t_title)
      or (u <> '' and lower(rtrim(btrim(coalesce(url, '')), '/')) = u)
   order by added_at limit 1;

  if hit is not null then
    update producer.opportunities set
      org         = coalesce(org, nullif(btrim(p_org), '')),
      kind        = coalesce(kind, nullif(btrim(p_kind), '')),
      location    = coalesce(location, nullif(btrim(p_location), '')),
      funding     = coalesce(funding, nullif(btrim(p_funding), '')),
      url         = coalesce(url, nullif(btrim(p_url), '')),
      deadline    = coalesce(deadline, nullif(btrim(p_deadline), '')),
      deadline_at = coalesce(deadline_at, p_deadline_at),
      opens_at    = coalesce(opens_at, p_opens_at),
      fit_stars   = coalesce(fit_stars, case when p_fit_stars between 1 and 3 then p_fit_stars end),
      why         = coalesce(why, nullif(btrim(p_why), '')),
      notes       = coalesce(notes, nullif(btrim(p_notes), '')),
      task_id     = coalesce(task_id, p_task_id)
     where id = hit
     returning * into r;
    return jsonb_build_object('created', false, 'id', r.id, 'title', r.title);
  end if;

  insert into producer.opportunities
    (title, org, kind, location, funding, url, deadline, deadline_at, opens_at,
     status, fit_stars, eligible, why, notes, source, task_id)
  values
    (t_title, nullif(btrim(p_org), ''), nullif(btrim(p_kind), ''), nullif(btrim(p_location), ''),
     nullif(btrim(p_funding), ''), nullif(btrim(p_url), ''), nullif(btrim(p_deadline), ''),
     p_deadline_at, p_opens_at,
     coalesce(nullif(btrim(p_status), ''), 'unknown'),
     case when p_fit_stars between 1 and 3 then p_fit_stars end,
     coalesce(p_eligible, true), nullif(btrim(p_why), ''), nullif(btrim(p_notes), ''),
     coalesce(nullif(btrim(p_source), ''), 'scout'), p_task_id)
  returning * into r;
  return jsonb_build_object('created', true, 'id', r.id, 'title', r.title);
end
$$;

-- 该复查哪几行。**不是全表每周查一遍**——表会长到几百行，那样又慢又贵。
-- 优先级见设计稿第六节：该开门的 > 该关门的 > 从没查过的 > 最久没查的。
create or replace function public.pa_opp_to_check(p_limit int default 20)
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.pri, x.staleness desc), '[]'::jsonb)
    from (
      select o.id, o.title, o.org, o.url, o.kind, o.deadline, o.deadline_at, o.opens_at,
             o.status, o.fit_stars, o.checked_at,
             case
               when o.opens_at is not null
                    and o.opens_at <= producer.today_local() + 14           then 0
               when o.status = 'open' and o.deadline_at is not null
                    and o.deadline_at < producer.today_local()              then 1
               when o.checked_at is null                                    then 2
               else 3
             end as pri,
             producer.today_local() - coalesce(o.checked_at::date, o.added_at::date) as staleness
        from producer.opportunities o
       where o.dropped_at is null
         and o.pursuit_id is null
       order by pri, staleness desc
       limit greatest(p_limit, 0)
    ) x;
$$;

-- 复查的结果。**status / 日期 只有这一个写者。**
create or replace function public.pa_opp_checked(
  p_id          uuid,
  p_status      text,
  p_deadline    text default null,
  p_deadline_at date default null,
  p_opens_at    date default null,
  p_note        text default null
)
returns void
language sql
security definer
set search_path = public, producer
as $$
  update producer.opportunities
     set status      = case when p_status in ('open','closed','unknown') then p_status else status end,
         -- 复查是这几个日期的唯一写者，所以这儿是覆盖不是填空；
         -- 但传 null 表示「这次没查到」，那就别把已有的抹掉
         deadline    = coalesce(nullif(btrim(p_deadline), ''), deadline),
         deadline_at = coalesce(p_deadline_at, deadline_at),
         opens_at    = case when p_status = 'open' then null else coalesce(p_opens_at, opens_at) end,
         checked_at  = now(),
         check_note  = nullif(btrim(p_note), '')
   where id = p_id;
$$;

-- 够得着的判断。**reach 那几列只有这一个写者。**
-- evidence 是必需的：没有凭证的 reach 不算数，宁可存 unknown。
create or replace function public.pa_opp_reach(
  p_id       uuid,
  p_reach    text,
  p_why      text default null,
  p_evidence text default null,
  p_url      text default null
)
returns void
language sql
security definer
set search_path = public, producer
as $$
  update producer.opportunities
     set reach = case when p_reach in ('realistic','stretch','longshot','unknown')
                      then p_reach else 'unknown' end,
         reach_why      = nullif(btrim(p_why), ''),
         reach_evidence = nullif(btrim(p_evidence), ''),
         reach_url      = nullif(btrim(p_url), ''),
         reach_at       = now()
   where id = p_id;
$$;

-- 本轮开着、还没捡过的行。挑的时候用。
create or replace function public.pa_opp_open_unpicked()
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select coalesce(jsonb_agg(to_jsonb(o) order by o.fit_stars desc nulls last, o.deadline_at nulls last), '[]'::jsonb)
    from producer.opportunities o
   where o.status = 'open'
     and o.dropped_at is null
     and o.pursuit_id is null
     and o.eligible;
$$;

-- 标「这一轮开着的」。界面上「本周还找到这些」就是这一个筛选。
create or replace function public.pa_opp_note_round(p_ids uuid[], p_round date)
returns int
language plpgsql
security definer
set search_path = public, producer
as $$
declare n int;
begin
  update producer.opportunities set noted_round = p_round
   where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end
$$;

-- ── 捡出来 / 别再提 ────────────────────────────────────────────
--
-- 捡出来 = 池子里一行变成看板上一张卡。走的还是 0119 那个唯一建卡口
-- （security definer 里调得动，不用给 anon 开 pa_create_pursuit）。
-- 幂等：已经捡过就返回原来那张卡，不建第二张。
create or replace function public.pa_pick_opportunity(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, producer
as $$
declare o producer.opportunities; made jsonb;
begin
  select * into o from producer.opportunities where id = p_id;
  if o.id is null then raise exception '池子里没有这一行：%', p_id; end if;
  if o.pursuit_id is not null then
    return jsonb_build_object('created', false, 'id', o.pursuit_id, 'already', true);
  end if;

  made := public.pa_create_pursuit(
    p_title       => o.title,
    p_kind        => o.kind,
    p_org         => o.org,
    p_location    => o.location,
    p_funding     => o.funding,
    p_deadline    => o.deadline,
    p_deadline_at => o.deadline_at,
    p_opens_at    => o.opens_at,
    p_url         => o.url,
    p_match_stars => o.fit_stars,
    p_why         => o.why,
    -- 够得着的判断跟着进卡：他在卡里要看得见「往届名单里有谁」这个凭证
    p_notes       => concat_ws(E'\n',
                       o.notes,
                       case when o.reach is not null then
                         format('【够得着吗】%s%s%s',
                           case o.reach when 'realistic' then '够得着'
                                        when 'stretch'   then '有点悬'
                                        when 'longshot'  then '多半白投'
                                        else '往届名单没查到' end,
                           coalesce(' —— ' || o.reach_why, ''),
                           coalesce(E'\n凭证：' || o.reach_evidence, ''))
                       end),
    p_eligible    => o.eligible,
    p_source      => o.source,
    p_task_id     => o.task_id);

  update producer.opportunities
     set pursuit_id = (made->>'id')::uuid, picked_at = now()
   where id = p_id;

  return made || jsonb_build_object('opportunity_id', p_id);
end
$$;

-- 别再提：不再复查、不再推。**不删行** —— 删了就没法回答「这个我当初为什么划掉」。
create or replace function public.pa_drop_opportunity(p_id uuid, p_why text default null)
returns void
language sql
security definer
set search_path = public, producer
as $$
  update producer.opportunities
     set dropped_at  = case when dropped_at is null then now() else dropped_at end,
         dropped_why = coalesce(nullif(btrim(p_why), ''), dropped_why)
   where id = p_id;
$$;

-- 划错了能划回来。没有撤销的破坏性动作，用着用着就没人敢按了。
create or replace function public.pa_undrop_opportunity(p_id uuid)
returns void
language sql
security definer
set search_path = public, producer
as $$
  update producer.opportunities set dropped_at = null, dropped_why = null where id = p_id;
$$;

-- ── 谁能调 ────────────────────────────────────────────────────
revoke all on function public.pa_upsert_opportunity(text, text, text, text, text, text, text, date, date, text, int, boolean, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.pa_opp_to_check(int) from public, anon, authenticated;
revoke all on function public.pa_opp_checked(uuid, text, text, date, date, text) from public, anon, authenticated;
revoke all on function public.pa_opp_reach(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.pa_opp_open_unpicked() from public, anon, authenticated;
revoke all on function public.pa_opp_note_round(uuid[], date) from public, anon, authenticated;
grant execute on function public.pa_upsert_opportunity(text, text, text, text, text, text, text, date, date, text, int, boolean, text, text, text, uuid) to service_role;
grant execute on function public.pa_opp_to_check(int) to service_role;
grant execute on function public.pa_opp_checked(uuid, text, text, date, date, text) to service_role;
grant execute on function public.pa_opp_reach(uuid, text, text, text, text) to service_role;
grant execute on function public.pa_opp_open_unpicked() to service_role;
grant execute on function public.pa_opp_note_round(uuid[], date) to service_role;

-- 捡出来和别再提是**你的动作**，浏览器直接调（跟 pa_set_stage 同级）
revoke all on function public.pa_pick_opportunity(uuid) from public;
revoke all on function public.pa_drop_opportunity(uuid, text) from public;
revoke all on function public.pa_undrop_opportunity(uuid) from public;
grant execute on function public.pa_pick_opportunity(uuid) to anon, authenticated, service_role;
grant execute on function public.pa_drop_opportunity(uuid, text) to anon, authenticated, service_role;
grant execute on function public.pa_undrop_opportunity(uuid) to anon, authenticated, service_role;

-- ── 读面 ──────────────────────────────────────────────────────
create or replace view public.v_pa_opportunities as
  select o.*, p.stage as pursuit_stage
    from producer.opportunities o
    left join producer.pursuits p on p.id = o.pursuit_id;
grant select on public.v_pa_opportunities to anon, authenticated, service_role;

-- ── 脉搏 ──────────────────────────────────────────────────────
insert into producer.pulse_areas (area, view_name)
values ('pool', 'public.v_pa_opportunities')
on conflict do nothing;
select producer.pulse_wire();

create or replace view public.v_pa_pulse as
  select n, board, thread, deliv, misc, at, tasks, pool from producer.pulse;
grant select on public.v_pa_pulse to anon, authenticated, service_role;

-- ── 池子对上看板已有的卡 ──────────────────────────────────────
--
-- Excel 里有 ✅已投递 / 🎉已录取 的行，它们在看板上多半早就有卡了。
-- 对上之后池子那行显示「已在看板上」，不再被复查、也不会再造一张重的。
-- 幂等，导入之后跑一次就行；再跑一次不会改已经对上的。
create or replace function public.pa_link_pool_to_cards()
returns int
language plpgsql
security definer
set search_path = public, producer
as $$
declare n int;
begin
  update producer.opportunities o
     set pursuit_id = p.id,
         picked_at  = coalesce(o.picked_at, p.created_at)
    from producer.pursuits p
   where o.pursuit_id is null
     and o.dropped_at is null
     and (lower(btrim(p.title)) = lower(btrim(o.title))
          or (coalesce(o.url, '') <> ''
              and lower(rtrim(btrim(coalesce(p.url, '')), '/'))
                = lower(rtrim(btrim(o.url), '/'))));
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.pa_link_pool_to_cards() from public, anon, authenticated;
grant execute on function public.pa_link_pool_to_cards() to service_role;
