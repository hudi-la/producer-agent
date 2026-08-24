-- Producer Agent — 语气是数据:五个格子,空着 = 出厂原文
--
-- workshop-edition 分支(2026-08-24)。设计稿 docs/specs/2026-08-24-the-voice-is-data.md。
--
-- 语气和判据(它是谁、信怎么写、什么该拒绝)原来是 brain/prompt.js 里的常量——
-- 最该属于艺术家自己的东西,却只有懂 JavaScript 才改得动。这支把它变成数据:
-- 五个可空的文本格子,空 = 用代码里的默认原文(一个字不变,prompt.test.js
-- 有冻结副本守着),填了哪格换哪格。
--
--   agent_name  agent 叫什么(Fairwind 是产品名,每人给自己的随便起)
--   persona     「你的活 + 怎么做事 + 你不能做的」那段行为描述
--   letter_rule 写信的规矩
--   form_rule   填表的规矩
--   judge_rule  判断时的那段小人格
--
-- 单例表,照 profile 的样子——多租户那刀(many-artists-one-database)把它
-- 改成每人一行,这张表天生就该是那个形状。
--
-- ⚠️ 这支**没有**应用到生产库(jjgvvtrsnoqnoigukobi)。它先落在 workshop 的
-- dev 项目上;合并回个人版时再应用,并注意跟个人线可能撞号(重号清理是
-- 多租户那刀的一部分)。brain 对「库里还没有这支」是安全的:RPC 不带 voice
-- 键 → ctx.voice = null → 全用默认。

create table if not exists producer.voice (
  id          uuid primary key default gen_random_uuid(),
  singleton   boolean not null default true,
  agent_name  text,
  persona     text,
  letter_rule text,
  form_rule   text,
  judge_rule  text,
  updated_at  timestamptz not null default now(),
  constraint voice_one_row unique (singleton),
  constraint voice_singleton_true check (singleton)
);

-- 先把那一行放好,pa_set_voice 才有东西可 update(照 profile 的路数)。
insert into producer.voice (singleton) values (true)
on conflict on constraint voice_one_row do nothing;

-- 读面。这个视图同时就是「配置导出」:学员愿意分享时,导的就是这五格。
create or replace view public.v_pa_voice as
  select v.agent_name, v.persona, v.letter_rule, v.form_rule, v.judge_rule, v.updated_at
    from producer.voice v;

grant select on public.v_pa_voice to anon, authenticated, service_role;

-- 写面。三态:null = 这格不动;空串/纯空白 = 清空回出厂;有字 = 换成这段。
-- (跟 pa_set_profile 不同:profile 的空串是「别动」,因为档案没有「出厂值」
-- 可回;语气有——清空是个真实需求,「玩坏了想回默认」必须有路。)
create or replace function public.pa_set_voice(
  p_agent_name  text default null,
  p_persona     text default null,
  p_letter_rule text default null,
  p_form_rule   text default null,
  p_judge_rule  text default null
)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
begin
  update producer.voice
     set agent_name  = case when p_agent_name  is null then agent_name  else nullif(btrim(p_agent_name),  '') end,
         persona     = case when p_persona     is null then persona     else nullif(btrim(p_persona),     '') end,
         letter_rule = case when p_letter_rule is null then letter_rule else nullif(btrim(p_letter_rule), '') end,
         form_rule   = case when p_form_rule   is null then form_rule   else nullif(btrim(p_form_rule),   '') end,
         judge_rule  = case when p_judge_rule  is null then judge_rule  else nullif(btrim(p_judge_rule),  '') end,
         updated_at  = now()
   where singleton;
end
$$;

revoke all on function public.pa_set_voice(text, text, text, text, text) from public;
grant execute on function public.pa_set_voice(text, text, text, text, text) to anon, authenticated, service_role;

-- ── Fairwind 的上下文带上 voice ─────────────────────────────
-- 整段重写(照 0066 那份),只加了 'voice' 那一格。不另开网络往返:
-- 这两个 RPC 本来每次开工就调。

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
      from producer.pursuit_messages m
      where m.pursuit_id = p_pursuit_id and m.deleted_at is null
    ), '[]'::jsonb),
    'deliverables', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.sort, d.created_at)
      from producer.deliverables d where d.pursuit_id = p_pursuit_id
    ), '[]'::jsonb),
    'threads', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at)
      from producer.pursuit_threads t where t.pursuit_id = p_pursuit_id
    ), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'filename', a.filename, 'mime', a.mime,
        'bytes', a.bytes, 'storage_key', a.storage_key,
        'source', a.source, 'created_at', a.created_at
      ) order by a.created_at)
      from producer.attachments a where a.pursuit_id = p_pursuit_id
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'title', e.title, 'body', e.body, 'concern', e.concern,
        'year', e.year, 'medium', e.medium, 'site_path', e.site_path, 'box', e.box,
        'meta', e.meta, 'tags', e.tags
      ) order by e.kind, e.sort)
      from producer.works e
    ), '[]'::jsonb),
    'voice', (select to_jsonb(v) from producer.voice v limit 1),
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1)
  );
$$;

revoke all on function public.pa_brain_context(uuid) from public, anon, authenticated;
grant execute on function public.pa_brain_context(uuid) to service_role;

-- 人版。同样整段重写,同样只加了那一格。
create or replace function public.pa_brain_person_context(p_contact_id uuid)
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select jsonb_build_object(
    'contact', (
      select to_jsonb(x) from (
        select c.*,
               (select i.name from producer.contacts i where i.id = c.intro_by) as intro_by_name,
               coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'stage', p.stage))
                           from producer.pursuits p where p.contact_id = c.id), '[]'::jsonb) as pursuits
          from producer.contacts c where c.id = p_contact_id
      ) x
    ),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at)
      from producer.pursuit_messages m
      where m.contact_id = p_contact_id and m.deleted_at is null
    ), '[]'::jsonb),
    'deliverables', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.sort, d.created_at)
      from producer.deliverables d where d.contact_id = p_contact_id
    ), '[]'::jsonb),
    'threads', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at)
      from producer.pursuit_threads t where t.contact_id = p_contact_id
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'title', e.title, 'body', e.body, 'concern', e.concern,
        'year', e.year, 'medium', e.medium, 'site_path', e.site_path, 'box', e.box,
        'meta', e.meta, 'tags', e.tags
      ) order by e.kind, e.sort)
      from producer.works e
    ), '[]'::jsonb),
    'voice', (select to_jsonb(v) from producer.voice v limit 1),
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1)
  );
$$;

revoke all on function public.pa_brain_person_context(uuid) from public, anon, authenticated;
grant execute on function public.pa_brain_person_context(uuid) to service_role;
