-- Producer Agent — scout 读你的档案,卡落你的看板
--
-- workshop-edition(2026-08-25,④)。单人版的 scout 是 demo/scout-prompt.md:
-- 画像写死、项目 ID 写死、模型手写 SQL、由 Hu Di 个人的定时任务用万能钥匙
-- 直插生产库。那条路在多租户里正确地死了(brain 只有学员身份,插不了表)。
--
-- 多租户重生的分工:
--   骨架(brain/scout.js):扫描流程、合法性、去重、上限、[[CARDS]] 协议
--   血肉(现读):画像来自 v_pa_profile,方向来自 v_pa_meta,源来自
--              tasks.config.sources,已有卡来自 v_pa_pursuit_cards
--   落库(这支):pa_scout_cards——模型不写 SQL,它交一份 JSON,
--              这个函数在 RLS 之下落卡,只可能落进调用者自己的看板
--
-- 规矩:invoker,不写 security definer(0118 起的铁律)。

create or replace function public.pa_scout_cards(p_task_id uuid, p_cards jsonb)
returns jsonb
language plpgsql
set search_path to 'public', 'producer'
as $function$
declare added int := 0; skipped int := 0; c jsonb; cap int := 5;
begin
  for c in select * from jsonb_array_elements(coalesce(p_cards, '[]'::jsonb)) loop
    exit when added >= cap;                       -- 每轮上限:宁缺毋滥,模型失控也灌不满看板
    if coalesce(btrim(c->>'title'), '') = '' then skipped := skipped + 1; continue; end if;
    -- 去重。RLS 之下这句只看得见自己的卡——去重天然按人,不用带 owner
    if exists (select 1 from producer.pursuits where title = btrim(c->>'title')) then
      skipped := skipped + 1; continue;
    end if;
    insert into producer.pursuits
           (title, kind, org, location, funding, deadline, url,
            match_stars, why, notes, source, task_id, eligible, stage)
    values (btrim(c->>'title'), c->>'kind', c->>'org', c->>'location', c->>'funding',
            c->>'deadline', c->>'url',
            coalesce(nullif(c->>'match_stars', '')::int, 2),
            c->>'why', nullif(c->>'notes', ''), 'scout', p_task_id,
            coalesce((c->>'eligible')::boolean, true), 'pending');
    added := added + 1;
  end loop;

  if p_task_id is not null then
    update producer.tasks
       set last_run_at = now(),
           last_result = '这轮新增 ' || added || ' 张'
                         || case when skipped > 0 then '(跳过 ' || skipped || ')' else '' end
     where id = p_task_id;
  end if;

  return jsonb_build_object('added', added, 'skipped', skipped);
end $function$;

revoke all on function public.pa_scout_cards(uuid, jsonb) from public, anon;
grant execute on function public.pa_scout_cards(uuid, jsonb) to authenticated, service_role;

-- 任务的 config(信息源住这儿)进读面。列只能追加在最后:
-- create or replace view 不许改老列的位置。
-- 2026-09-16 合并后:主线 0125 的 v_pa_tasks 已经带 config(和排期列),不再重定义——
-- create or replace 会砍掉那些列。下面只重申 invoker 和权限。

-- create or replace 不保证保留视图选项,invoker 这一下必须重申——
-- 掉了它,视图就以定义者身份跑,行级权限被静默绕过。
alter view public.v_pa_tasks set (security_invoker = true);
revoke all on public.v_pa_tasks from public, anon;
grant select on public.v_pa_tasks to authenticated, service_role;

-- 注册礼包多一件:每人一条出厂的 scout 任务。
-- config 留空 = 用产品默认源(brain/scout.js 的 DEFAULT_SOURCES,
-- 唯一的一份,不在 SQL 里抄第二遍);学员在 config.sources 里换自己的。
create or replace function producer.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = producer, public
as $$
begin
  insert into producer.profile (owner) values (new.id) on conflict do nothing;
  insert into producer.voice   (owner) values (new.id) on conflict do nothing;
  insert into producer.tasks   (name, type, schedule, sort, owner)
  values ('每周找机会', 'scout_aggregators', 'weekly', 10, new.id)
  on conflict do nothing;
  return new;
end
$$;
