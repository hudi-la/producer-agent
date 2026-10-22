-- 重说：把发错的那句和它之后的对话撤掉，重新说一遍。
--
-- 设计稿：docs/specs/2026-08-15-resay-design.md
--
-- 为什么要有这个：Fairwind 带着这条线的**全部往来**去想（brain/prompt.js 的
-- historyBlock 把 messages 原样铺开）。所以你说错的那一句会一直躺在 prompt 里
-- 被一轮一轮读到 —— 你在下一句里说「不对我刚说错了」也没用，它得同时消化
-- 两份互相矛盾的话，而且往来越长这件事越糟。
--
-- ── 软删，不是真删 ──────────────────────────────────────────────
-- 打一个 deleted_at 的标，读面全部滤掉。对人来说跟真删没有任何差别；
-- 差别只在万一撤错了、或者哪天想知道当时到底说了什么，开 SQL 还捞得回来。
--
-- **读面有两处，必须一起改**：
--   · v_pa_pursuit_messages       → 界面上看不见
--   · pa_brain_context / _person_ → Fairwind 的 prompt 里没有
-- 只改前者的话，你看不见但它还记得 —— 那比不做还坏：你以为撤干净了，
-- 它却仍在按那句错话想事情，而你永远查不出为什么。
--
-- 照 0025 / 0027 / 0044 的规矩：那两个函数 create or replace 必须**整段重写**，
-- 漏掉 security definer 或 search_path 会悄悄改掉权限模型且不报错。

-- ══ 一、加那一列 ═══════════════════════════════════════════════

alter table producer.pursuit_messages
  add column if not exists deleted_at timestamptz;

comment on column producer.pursuit_messages.deleted_at is
  '你「重说」时撤掉的那几条。读面一律滤掉（界面和 Fairwind 都看不见），行还在。';

-- 读面每次都带 deleted_at is null，所以现有那几条索引要跟上一个部分索引，
-- 不然一条长往来每次都要把撤掉的行也扫一遍。
create index if not exists pm_live_by_pursuit
  on producer.pursuit_messages (pursuit_id, created_at)
  where deleted_at is null;
create index if not exists pm_live_by_contact
  on producer.pursuit_messages (contact_id, created_at)
  where contact_id is not null and deleted_at is null;

-- ══ 二、读面①：界面 ════════════════════════════════════════════
-- create or replace view 只能改表达式、不能动列名列序 —— 这儿只加了一句 where，
-- 列一个没动（照 0040 那份逐字抄下来）。
create or replace view public.v_pa_pursuit_messages as
  select id, pursuit_id, role, kind, content, meta, created_at,
         gmail_message_id, body_raw, contact_id, counterpart_email
    from producer.pursuit_messages
   where deleted_at is null;
grant select on public.v_pa_pursuit_messages to anon, authenticated, service_role;

-- ══ 三、撤 ═════════════════════════════════════════════════════
--
-- 只撤**你跟 Fairwind 的一来一回**。这几样一个都不碰：
--   邮件（kind='email'）—— 那封信真的收到了 / 真的发出去了，你改口不能让它没发生
--   备注（role='note'）—— 是你自己记下的事实，不是它说的话
--   讲懂（kind='brief'）—— 对这个机会的核查结果，跟你说错的那句无关
--   草稿（kind='draft'）—— 右栏产出可能正指着它（deliverables.source_msg），撤了线索就断
--
-- 于是撤完之后时间线上可能留着一封信、一条备注，而它们中间的对话没了。
-- 这是对的：事实留着，说错的话没了。
--
-- 锚点必须是你自己的一句普通对话。不是就报错 —— 这个函数不该能拿来撤别的东西，
-- 而「拿不到就静悄悄什么都不做」会让界面以为撤成功了。
--
-- 给 anon：这是**你在整理自己的对话**，跟 pa_set_ball / pa_set_stage 一样
-- 走浏览器直连。脑子开没开，不该影响你撤掉自己说错的话。
create or replace function public.pa_rewind_chat(p_msg_id uuid)
returns int
language plpgsql
security definer
set search_path = public, producer
as $$
declare
  a producer.pursuit_messages;
  n int;
begin
  select * into a from producer.pursuit_messages where id = p_msg_id;
  if not found then
    raise exception '库里没有这条（id=%）', p_msg_id;
  end if;
  if a.deleted_at is not null then
    raise exception '这条已经撤过了';
  end if;
  if a.role <> 'artist' or coalesce(a.kind, 'message') <> 'message' then
    raise exception '只能从你自己说的一句话往后撤（这条是 role=% kind=%）', a.role, a.kind;
  end if;

  -- 范围锁死在同一条流里。机会线的对话 contact_id 是空，人的对话 pursuit_id 是空，
  -- is not distinct from 一句话把两种都盖住 —— 分岔写两遍，迟早有一边判漏，
  -- 而判漏的后果是撤掉了别条线上的话。
  --
  -- 「从这句起」用行比较：同一毫秒落库的两条（你那句和它的回复偶尔会撞上）
  -- 也有确定的先后，不会漏一条也不会多撤一条。
  update producer.pursuit_messages m
     set deleted_at = now()
   where m.pursuit_id is not distinct from a.pursuit_id
     and m.contact_id is not distinct from a.contact_id
     and (m.created_at, m.id) >= (a.created_at, a.id)
     and m.deleted_at is null
     and m.role in ('artist', 'producer')
     and coalesce(m.kind, 'message') = 'message';

  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.pa_rewind_chat(uuid) from public;
grant execute on function public.pa_rewind_chat(uuid) to anon, authenticated, service_role;

-- ══ 四、读面②：Fairwind 的上下文 ═══════════════════════════════
-- 整段重写（照 0044 那份），只在 messages 那一格加了 and m.deleted_at is null。
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
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1)
  );
$$;

revoke all on function public.pa_brain_context(uuid) from public, anon, authenticated;
grant execute on function public.pa_brain_context(uuid) to service_role;

-- 人版。同样整段重写（照 0034 那份），同样只加了那一句。
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
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1)
  );
$$;

revoke all on function public.pa_brain_person_context(uuid) from public, anon, authenticated;
grant execute on function public.pa_brain_person_context(uuid) to service_role;
