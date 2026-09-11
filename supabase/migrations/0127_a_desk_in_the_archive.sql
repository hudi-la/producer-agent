-- 档案里支一张书桌。
--
-- 设计稿：docs/specs/2026-09-11-a-desk-in-the-archive-design.md
--
-- 「我的档案」每一栏右边开一条对话：陪他把自己的东西写准（改作品描述、
-- 搭一份课程 proposal）。它**一个字都写不进库** —— 所有进档案的字是他自己
-- 复制过去、在那一格里自己改的。所以这支迁移里没有一支给 agent 的写入口。
--
-- ── 为什么是新表，不挂进 pursuit_messages ─────────────────────────
--
-- 0043 立着 pm_owner_chk：进那张表的每一行，要么挂着机会线、要么挂着人、
-- 要么至少记下了对面的邮箱地址，三样占一样。它挡的是「一封谁也不知道干嘛的信
-- 悄悄进库然后再也没人看见」。
--
-- 档案里的闲聊这三样一样都没有。挂进去就得放宽那条约束，**而一放宽，
-- 那道护栏对真的邮件也就不再成立了** —— 一封真正无主的信从此也能溜进来。
-- 为了省一张表拆掉一条正在管事的护栏，不划算。
--
-- （查过一条不成立的顾虑，留着记账：本来担心闲聊会被「第几次 follow up」
-- 0117 / 「连发三封没回」0118 / 未读红点 0124 数进去。不会 —— 那几处数的全是
-- kind='email'，而且都要求挂着线或挂着人。机会线上的聊天早就跟它们同住一张表、
-- 从来没被数进去过。）
--
-- 软的一条：那张表叫「往来」，记的是他跟外面的人之间**发生过什么**。
-- 档案里跟 AI 商量怎么写不是往来，是草稿间。

-- ══ 一、书桌上的对话 ═══════════════════════════════════════════

create table if not exists producer.studio_messages (
  id          uuid primary key default gen_random_uuid(),
  section     text not null,                          -- 档案页左栏那一格的 key
  role        text not null,                          -- artist | producer | system
  kind        text not null default 'message',
  content     text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz                             -- 「重说」打标，行还在
);

-- section 不设外键、不设枚举：「格」是前端 buildSections() 算出来的，
-- 库里没有这张表。写死一个 check 的话，以后加一类条目就会在这儿炸，
-- 而炸的形式是「他打的字存不进去」。
comment on column producer.studio_messages.section is
  '档案页左栏那一格：about / work / statement / job / education / skill / offer / credit:exhibition …。故意不设约束，见 0127 顶上的注释';
comment on column producer.studio_messages.deleted_at is
  '「重说」撤掉的那几条。读面一律滤掉，行还在（照 0066 的规矩）';

create index if not exists studio_messages_sec_idx
  on producer.studio_messages (section, created_at) where deleted_at is null;

-- ══ 二、「在写」那个标 ═════════════════════════════════════════
--
-- 默认 false = 写完的。**现有条目一条都不变**，一个字都不会突然从
-- Fairwind 眼前消失。只有他新加的、或他自己点成「在写」的才是 true。
--
-- 这个标只管一件具体的事：**没写完的东西不许被当成战绩发出去。**
-- 所以隐形的地方是外联那两支上下文（pa_brain_context / _person_），
-- 那是写申请、判匹配时翻的弹药库。
--
-- **书桌这边看得见，而且标着「还在写」** —— 他正是在书桌上写它的，
-- 藏起来他那份 proposal 就从陪他写的那个人眼前消失了。
-- 档案页当然也照常显示全部：隐形是对 AI，不是对他。
alter table producer.works
  add column if not exists draft boolean not null default false;

comment on column producer.works.draft is
  '「在写」。true 的条目不进外联那两支上下文（写申请时翻不到），但书桌上看得见、档案页照常显示';

-- 读面补一列。create or replace view 不能动列名列序 —— 照 0007 那份逐字抄，
-- draft 加在末尾。
create or replace view public.v_pa_entries as
  select id, kind, title, medium, year, body, concern, site_path,
         source, box, meta, images, tags, sort, draft
  from producer.works
  order by sort;

grant select on public.v_pa_entries to anon, authenticated;

-- ══ 三、他自己的手：加一条 / 切标 ═══════════════════════════════
--
-- 档案页至今**没有任何一个「加一条」的入口**：0065 的 pa_set_entry 只能改
-- 已有的那条（要 p_id），Library 里那行「+ 补一条 / 丢进材料」是一段死文字。
-- 于是「工作坊 · 可提供」那一栏想放一份新 proposal 进去，只有开 SQL 一条路。
--
-- 新条目一律 draft = true：刚建的东西按定义没写完，不该被当成战绩。
-- 其余字段建完在页面上就地改（InlineText / EditRow 已经有了）。
--
-- 给 anon，跟 pa_set_entry 同一条路 —— 这是他自己的手，脑子开没开不该影响他
-- 往自己的档案里加一条。
create or replace function public.pa_add_entry(p_kind text, p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = public, producer
as $$
declare new_id uuid;
begin
  if coalesce(btrim(p_kind), '') = '' then
    raise exception 'kind 不能为空 —— 不知道这条该进哪一栏';
  end if;

  insert into producer.works (kind, title, draft, source, sort)
  values (
    btrim(p_kind),
    coalesce(nullif(btrim(p_title), ''), '（未命名）'),
    true,
    'manual',
    coalesce((select max(sort) from producer.works), 0) + 1
  )
  returning id into new_id;

  return new_id;
end
$$;

revoke all on function public.pa_add_entry(text, text) from public;
grant execute on function public.pa_add_entry(text, text) to anon, authenticated, service_role;

create or replace function public.pa_set_entry_draft(p_id uuid, p_draft boolean)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
begin
  if p_draft is null then
    raise exception 'draft 要 true 或 false，不能是 null';
  end if;
  update producer.works set draft = p_draft where id = p_id;
  if not found then
    raise exception '库里没有这条（id=%）', p_id;
  end if;
end
$$;

revoke all on function public.pa_set_entry_draft(uuid, boolean) from public;
grant execute on function public.pa_set_entry_draft(uuid, boolean) to anon, authenticated, service_role;

-- ══ 四、读书桌上的对话 ═════════════════════════════════════════
-- 给 anon：跟 v_pa_pursuit_messages 一样，读自己的对话是浏览器直连的事。
create or replace function public.pa_studio_thread(p_section text)
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select coalesce((
    select jsonb_agg(to_jsonb(m) order by m.created_at)
    from producer.studio_messages m
    where m.section = p_section and m.deleted_at is null
  ), '[]'::jsonb);
$$;

revoke all on function public.pa_studio_thread(text) from public;
grant execute on function public.pa_studio_thread(text) to anon, authenticated, service_role;

-- 「重说」：把说错的那句和它之后的撤掉。照 0066 那支的写法。
--
-- 锚点必须是他自己说的一句普通话 —— 这个函数不该能拿来撤别的东西，
-- 而「拿不到就静悄悄什么都不做」会让界面以为撤成功了。
--
-- 范围锁死在同一个 section 里：一栏一条对话，撤不到别栏去。
create or replace function public.pa_rewind_studio(p_msg_id uuid)
returns int
language plpgsql
security definer
set search_path = public, producer
as $$
declare
  a producer.studio_messages;
  n int;
begin
  select * into a from producer.studio_messages where id = p_msg_id;
  if not found then
    raise exception '库里没有这条（id=%）', p_msg_id;
  end if;
  if a.deleted_at is not null then
    raise exception '这条已经撤过了';
  end if;
  if a.role <> 'artist' then
    raise exception '只能从你自己说的一句话往后撤（这条是 role=%）', a.role;
  end if;

  -- 「从这句起」用行比较：同一毫秒落库的两条（你那句和它的回复偶尔会撞上）
  -- 也有确定的先后，不会漏一条也不会多撤一条。
  update producer.studio_messages m
     set deleted_at = now()
   where m.section = a.section
     and (m.created_at, m.id) >= (a.created_at, a.id)
     and m.deleted_at is null;

  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.pa_rewind_studio(uuid) from public;
grant execute on function public.pa_rewind_studio(uuid) to anon, authenticated, service_role;

-- ══ 五、书桌的上下文 ═══════════════════════════════════════════
--
-- pa_brain_context 要 p_pursuit_id，书桌这边没有线，所以单开一支。
-- 形状比那两支小得多：没有机会线、没有产出、没有邮件线索、没有附件。
--
-- entries **不滤 draft**（见第二节）：他正在书桌上写那几条。
-- 哪几条没写完由 draft 这个字段自己说，brain 那边照着标出来。
create or replace function public.pa_studio_context(p_section text)
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at)
      from producer.studio_messages m
      where m.section = p_section and m.deleted_at is null
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'title', e.title, 'body', e.body,
        'concern', e.concern, 'year', e.year, 'medium', e.medium,
        'site_path', e.site_path, 'box', e.box, 'meta', e.meta,
        'tags', e.tags, 'images', e.images, 'draft', e.draft
      ) order by e.kind, e.sort)
      from producer.works e
    ), '[]'::jsonb),
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1)
  );
$$;

revoke all on function public.pa_studio_context(text) from public, anon, authenticated;
grant execute on function public.pa_studio_context(text) to service_role;

-- 写：只能往书桌上加一条对话。给 service_role —— 落库走 brain，
-- 跟 pa_add_message / pa_add_contact_message 一路。
create or replace function public.pa_add_studio_message(
  p_section text,
  p_role    text,
  p_content text,
  p_kind    text  default 'message',
  p_meta    jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, producer
as $$
declare r producer.studio_messages;
begin
  if coalesce(btrim(p_section), '') = '' then
    raise exception 'section 不能为空';
  end if;
  if p_role not in ('artist', 'producer', 'system') then
    raise exception 'role 只能是 artist|producer|system，收到 %', p_role;
  end if;
  if coalesce(btrim(p_content), '') = '' then
    raise exception 'content 不能为空';
  end if;

  insert into producer.studio_messages (section, role, kind, content, meta)
  values (btrim(p_section), p_role,
          coalesce(nullif(btrim(p_kind), ''), 'message'),
          p_content,
          coalesce(p_meta, '{}'::jsonb))
  returning * into r;

  return to_jsonb(r);
end
$$;

revoke all on function public.pa_add_studio_message(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.pa_add_studio_message(text, text, text, text, jsonb)
  to service_role;

-- ══ 六、外联那两支上下文：滤掉在写的，并补上 id / images ═══════════
--
-- 两件事一起做：
--   · where not e.draft —— 没写完的不进写申请的弹药库
--   · 'id' —— 一直没给。它看得见那段描述，但指不出「就这一条」
--   · 'images' —— 一直没给。**Fairwind 从没见过他任何一件作品长什么样**
--
-- 照 0123 那两份**整段重写**，只动 entries 那一格。漏掉 security definer
-- 或 search_path 会悄悄改掉权限模型且不报错（0025 的教训）。

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
        'id', e.id, 'kind', e.kind, 'title', e.title, 'body', e.body, 'concern', e.concern,
        'year', e.year, 'medium', e.medium, 'site_path', e.site_path, 'box', e.box,
        'meta', e.meta, 'tags', e.tags, 'images', e.images
      ) order by e.kind, e.sort)
      from producer.works e where not e.draft
    ), '[]'::jsonb),
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1),
    'state', (select to_jsonb(s) from public.v_pa_state s
               where s.subject_kind = 'pursuit' and s.subject_id = p_pursuit_id limit 1)
  );
$$;

revoke all on function public.pa_brain_context(uuid) from public, anon, authenticated;
grant execute on function public.pa_brain_context(uuid) to service_role;

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
        'id', e.id, 'kind', e.kind, 'title', e.title, 'body', e.body, 'concern', e.concern,
        'year', e.year, 'medium', e.medium, 'site_path', e.site_path, 'box', e.box,
        'meta', e.meta, 'tags', e.tags, 'images', e.images
      ) order by e.kind, e.sort)
      from producer.works e where not e.draft
    ), '[]'::jsonb),
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1),
    'state', (select to_jsonb(s) from public.v_pa_state s
               where s.subject_kind = 'contact' and s.subject_id = p_contact_id limit 1)
  );
$$;

revoke all on function public.pa_brain_person_context(uuid) from public, anon, authenticated;
grant execute on function public.pa_brain_person_context(uuid) to service_role;
