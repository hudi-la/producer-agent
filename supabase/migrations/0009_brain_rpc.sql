-- Producer Agent — 给 brain sidecar 开的读写口
--
-- 为什么用函数而不是直连 producer schema：
--   producer 没有加进 Supabase 的 Exposed schemas（共用项目，不想动全局设置），
--   所以 supabase-js 无论拿什么 key 都够不着 producer.*。沿用「在 public 开口子」
--   的既有做法，只是这次要写，所以是 security definer 函数而不是视图。
--
-- 护栏（结构性的，不是嘱咐）：
--   对外只开两个函数——读上下文、写一条消息。**没有改 stage / 改盒子 / 建卡的口**，
--   所以渡在结构上就动不了这些。要动，得再单独开函数。
--   两个函数都只 grant 给 service_role（只存在于本机 brain/.env），
--   anon / authenticated 一律 revoke —— 浏览器碰不到。
--
-- (Applied to project jjgvvtrsnoqnoigukobi via MCP on 2026-08-03.)

-- ── 读：渡开工前想起这条线的一切 ───────────────────────────────
-- 一次拿全：机会线 + 全部往来 + 战绩信息库 + 画像。
-- 画像走这里而不是建视图，是为了让 O-1/地址这类私密字段永远不落到 anon 能读的面上。
create or replace function public.pa_brain_context(p_pursuit_id uuid)
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select jsonb_build_object(
    'pursuit', (
      select to_jsonb(x) from (
        select p.*, w.title as work_title
        from producer.pursuits p
        left join producer.works w on w.id = p.work_id
        where p.id = p_pursuit_id
      ) x
    ),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at)
      from producer.pursuit_messages m where m.pursuit_id = p_pursuit_id
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'title', e.title, 'body', e.body, 'concern', e.concern,
        'year', e.year, 'medium', e.medium, 'site_path', e.site_path, 'box', e.box
      ) order by e.kind, e.sort)
      from producer.works e
    ), '[]'::jsonb),
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1)
  );
$$;

-- ── 写：只能往往来历史里加一条 ─────────────────────────────────
create or replace function public.pa_add_message(
  p_pursuit_id uuid,
  p_role       text,
  p_content    text,
  p_kind       text default 'message'
)
returns jsonb
language plpgsql
security definer
set search_path = public, producer
as $$
declare r producer.pursuit_messages;
begin
  if p_role not in ('artist', 'producer', 'system', 'note') then
    raise exception 'role 只能是 artist|producer|system|note，收到 %', p_role;
  end if;
  if coalesce(btrim(p_content), '') = '' then
    raise exception 'content 不能为空';
  end if;

  insert into producer.pursuit_messages (pursuit_id, role, kind, content)
  values (p_pursuit_id, p_role, coalesce(nullif(btrim(p_kind), ''), 'message'), p_content)
  returning * into r;

  return to_jsonb(r);
end
$$;

-- ── 谁能调 ────────────────────────────────────────────────────
revoke all on function public.pa_brain_context(uuid) from public, anon, authenticated;
revoke all on function public.pa_add_message(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.pa_brain_context(uuid) to service_role;
grant execute on function public.pa_add_message(uuid, text, text, text) to service_role;
