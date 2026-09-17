-- Producer Agent — 造卡任务按点跑
-- 设计稿：docs/specs/2026-09-02-scheduled-scout-design.md
--
-- 在这之前「每周找机会」挂在 claude.ai 的定时任务里：提示词在那边、结果写 Excel、
-- 再由人肉搬进这儿造卡。现在提示词进库（你在面板里改），排期进库（你在面板里改），
-- 脑子到点读提示词联网找，找到的经唯一一个新口 pa_create_pursuit 落成卡。
--
-- 护栏没动：模型拿到的工具还是 WebSearch / WebFetch，它只**报**机会（[[CARDS]] 信封），
-- 解析和落库是脑子的事。

-- ── 一、任务能排期、能存提示词 ─────────────────────────────────
alter table producer.tasks
  add column if not exists prompt        text,
  add column if not exists run_every     text,
  add column if not exists run_weekday   int,
  add column if not exists run_hour      int,
  add column if not exists next_run_at   timestamptz,
  add column if not exists running_since timestamptz,
  add column if not exists run_now       boolean not null default false;

alter table producer.tasks drop constraint if exists tasks_run_every_chk;
alter table producer.tasks add constraint tasks_run_every_chk
  check (run_every is null or run_every in ('week', 'day'));
alter table producer.tasks drop constraint if exists tasks_run_weekday_chk;
alter table producer.tasks add constraint tasks_run_weekday_chk
  check (run_weekday is null or run_weekday between 0 and 6);
alter table producer.tasks drop constraint if exists tasks_run_hour_chk;
alter table producer.tasks add constraint tasks_run_hour_chk
  check (run_hour is null or run_hour between 0 and 23);

comment on column producer.tasks.prompt        is '你能改的那段提示词（画像 / 来源 / 筛选规则）。今天几号、库里已有哪些、输出格式由脑子跑的时候补在后面';
comment on column producer.tasks.run_every     is 'week / day / null（null = 手动或事件触发，不排期）';
comment on column producer.tasks.run_weekday   is '0–6，0 = 周日。只在 week 时用';
comment on column producer.tasks.run_hour      is '0–23，按 producer.app_tz() 的当地时间';
comment on column producer.tasks.next_run_at   is '下次到点。改排期就重算；跑完一轮从 now() 往后算下一次，所以补跑不会漂';
comment on column producer.tasks.running_since is '脑子认领的时刻。超过 2 小时算卡死，可以再认领';
comment on column producer.tasks.run_now       is '「现在跑一次」按下去 = true；脑子认领时清掉。关着的任务也能这样跑一次';

-- 下一个到点：after 之后、按当地时区、下一个「周 weekday 的 hour 点整」或「每天 hour 点整」。
create or replace function producer.task_next_run(
  p_every text, p_weekday int, p_hour int, p_after timestamptz default now()
)
returns timestamptz
language plpgsql stable
set search_path = public, producer
as $$
declare z text := producer.app_tz(); loc timestamp; cand timestamp; d date;
begin
  if p_every is null then return null; end if;
  if p_hour is null then raise exception 'task_next_run：排了期就得有几点（run_hour）'; end if;
  loc := p_after at time zone z;                          -- 当地的裸时间
  if p_every = 'day' then
    cand := date_trunc('day', loc) + make_interval(hours => p_hour);
    if cand <= loc then cand := cand + interval '1 day'; end if;
  elsif p_every = 'week' then
    if p_weekday is null then raise exception 'task_next_run：每周跑得有周几（run_weekday）'; end if;
    d := loc::date + ((p_weekday - extract(dow from loc)::int + 7) % 7);
    cand := d + make_interval(hours => p_hour);
    if cand <= loc then cand := cand + interval '7 days'; end if;
  else
    raise exception 'task_next_run：run_every 只认 week / day，收到 %', p_every;
  end if;
  return cand at time zone z;                              -- 裸的当地时间 → 时刻
end
$$;

-- ── 二、浏览器的口：改一条任务、现在跑一次 ─────────────────────
-- 跟 pa_set_profile 同级：能改的列写死在函数里。
-- p_run_every 传 'manual' = 取消排期（null 是「这次没传」，两个意思得分开）。
create or replace function public.pa_set_task(
  p_id          uuid,
  p_enabled     boolean default null,
  p_prompt      text    default null,
  p_run_every   text    default null,
  p_run_weekday int     default null,
  p_run_hour    int     default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, producer
as $$
declare t producer.tasks; every text; wd int; hr int;
begin
  select * into t from producer.tasks where id = p_id;
  if t.id is null then raise exception '没有这条任务：%', p_id; end if;

  every := case when p_run_every is null then t.run_every
                when p_run_every = 'manual' then null
                else p_run_every end;
  wd := coalesce(p_run_weekday, t.run_weekday);
  hr := coalesce(p_run_hour, t.run_hour);
  -- 排了期却没填几点：给个像样的默认，别让「每周」存成永远不到点
  if every is not null and hr is null then hr := 8; end if;
  if every = 'week' and wd is null then wd := 1; end if;

  update producer.tasks
     set enabled     = coalesce(p_enabled, enabled),
         prompt      = coalesce(p_prompt, prompt),
         run_every   = every,
         run_weekday = wd,
         run_hour    = hr,
         -- 排期没变就不动 next_run_at（不然每改一次提示词都往后推一周）
         next_run_at = case
           when every is distinct from t.run_every
             or wd is distinct from t.run_weekday
             or hr is distinct from t.run_hour
             or (next_run_at is null and every is not null)
           then producer.task_next_run(every, wd, hr, now())
           else next_run_at end,
         -- 老那列留着当兼容读法
         schedule    = case every when 'week' then 'weekly' when 'day' then 'daily' else schedule end
   where id = p_id
   returning * into t;
  return to_jsonb(t);
end
$$;

create or replace function public.pa_run_task_now(p_id uuid)
returns void
language sql
security definer
set search_path = public, producer
as $$
  update producer.tasks set run_now = true where id = p_id and prompt is not null;
$$;

revoke all on function public.pa_set_task(uuid, boolean, text, text, int, int) from public;
revoke all on function public.pa_run_task_now(uuid) from public;
grant execute on function public.pa_set_task(uuid, boolean, text, text, int, int) to anon, authenticated, service_role;
grant execute on function public.pa_run_task_now(uuid) to anon, authenticated, service_role;

-- ── 三、脑子的口：到点的、认领、收工、去重名单、建卡 ─────────────
create or replace function public.pa_tasks_due()
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.sort), '[]'::jsonb)
    from producer.tasks t
   where t.prompt is not null
     and (t.running_since is null or t.running_since < now() - interval '2 hours')
     and (t.run_now or (t.enabled and t.next_run_at is not null and t.next_run_at <= now()));
$$;

-- 认领。两个脑子（或一个脑子的两轮）同时到这儿，只有一个拿得到 true。
create or replace function public.pa_task_start(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, producer
as $$
declare n int;
begin
  update producer.tasks
     set running_since = now(), run_now = false
   where id = p_id
     and (running_since is null or running_since < now() - interval '2 hours');
  get diagnostics n = row_count;
  return n = 1;
end
$$;

-- 收工。没跑成也算收工（p_ok=false）：下一次照排，别在同一个点上反复撞。
create or replace function public.pa_task_finish(p_id uuid, p_result text, p_ok boolean default true)
returns void
language sql
security definer
set search_path = public, producer
as $$
  update producer.tasks
     set last_run_at   = now(),
         last_result   = p_result,
         running_since = null,
         next_run_at   = producer.task_next_run(run_every, run_weekday, run_hour, now())
   where id = p_id;
$$;

-- 去重的名单：库里已有的标题 / 机构 / 链接。给脑子拼进提示词，也给它落库前再对一遍。
create or replace function public.pa_pursuit_titles()
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select coalesce(jsonb_agg(jsonb_build_object('title', p.title, 'org', p.org, 'url', p.url, 'stage', p.stage)
                            order by p.created_at desc), '[]'::jsonb)
    from producer.pursuits p;
$$;

-- 建一张卡。**这是脑子建卡的唯一入口。**
-- 标题（忽略大小写和首尾空白）或链接（忽略大小写和末尾斜杠）已存在就不建，
-- 返回 {created:false, id:已有那张}——同一个机会两张卡比漏一张更坏。
create or replace function public.pa_create_pursuit(
  p_title       text,
  p_kind        text    default null,
  p_org         text    default null,
  p_location    text    default null,
  p_funding     text    default null,
  p_deadline    text    default null,
  p_deadline_at date    default null,
  p_opens_at    date    default null,
  p_url         text    default null,
  p_match_stars int     default null,
  p_why         text    default null,
  p_notes       text    default null,
  p_eligible    boolean default true,
  p_source      text    default 'scout_aggregators',
  p_task_id     uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, producer
as $$
declare t_title text := btrim(p_title); u text := lower(rtrim(btrim(coalesce(p_url, '')), '/')); hit uuid; r producer.pursuits;
begin
  if coalesce(t_title, '') = '' then raise exception '建卡得有标题'; end if;

  select id into hit from producer.pursuits
   where lower(btrim(producer.pursuits.title)) = lower(t_title)
      or (u <> '' and lower(rtrim(btrim(coalesce(url, '')), '/')) = u)
   order by created_at limit 1;
  if hit is not null then
    return jsonb_build_object('created', false, 'id', hit);
  end if;

  insert into producer.pursuits
    (title, kind, org, location, funding, deadline, deadline_at, opens_at, url,
     match_stars, why, notes, eligible, source, task_id, stage)
  values
    (t_title, nullif(btrim(p_kind), ''), nullif(btrim(p_org), ''), nullif(btrim(p_location), ''),
     nullif(btrim(p_funding), ''), nullif(btrim(p_deadline), ''), p_deadline_at, p_opens_at,
     nullif(btrim(p_url), ''), case when p_match_stars in (2, 3) then p_match_stars else null end,
     nullif(btrim(p_why), ''), nullif(btrim(p_notes), ''), coalesce(p_eligible, true),
     coalesce(nullif(btrim(p_source), ''), 'scout_aggregators'), p_task_id, 'pending')
  returning * into r;
  return jsonb_build_object('created', true, 'id', r.id);
end
$$;

revoke all on function public.pa_tasks_due() from public, anon, authenticated;
revoke all on function public.pa_task_start(uuid) from public, anon, authenticated;
revoke all on function public.pa_task_finish(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.pa_pursuit_titles() from public, anon, authenticated;
revoke all on function public.pa_create_pursuit(text, text, text, text, text, text, date, date, text, int, text, text, boolean, text, uuid)
  from public, anon, authenticated;
grant execute on function public.pa_tasks_due() to service_role;
grant execute on function public.pa_task_start(uuid) to service_role;
grant execute on function public.pa_task_finish(uuid, text, boolean) to service_role;
grant execute on function public.pa_pursuit_titles() to service_role;
grant execute on function public.pa_create_pursuit(text, text, text, text, text, text, date, date, text, int, text, text, boolean, text, uuid)
  to service_role;

-- ── 四、读面：面板要看到排期和提示词 ─────────────────────────────
-- create or replace 只能在末尾追加列，正好——前 8 列原样，新的接在后面。
create or replace view public.v_pa_tasks as
  select id, name, type, enabled, schedule, last_result, last_run_at, sort,
         prompt, run_every, run_weekday, run_hour, next_run_at, running_since, run_now, config
    from producer.tasks;
grant select on public.v_pa_tasks to anon, authenticated, service_role;

-- ── 五、脉搏：面板开着时看得见「正在跑」变成「新增 3 张」 ─────────
insert into producer.pulse_areas (area, view_name)
values ('tasks', 'public.v_pa_tasks')
on conflict do nothing;
select producer.pulse_wire();

create or replace view public.v_pa_pulse as
  select n, board, thread, deliv, misc, at, tasks from producer.pulse;
grant select on public.v_pa_pulse to anon, authenticated, service_role;
