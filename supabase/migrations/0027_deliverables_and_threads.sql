-- Producer Agent — 产出（右栏）+ 邮件线索（左栏往来）
--
-- 设计稿：docs/specs/2026-08-05-focus-three-column-and-email-design.md
--
-- 这一刀补三样，都是「页面能干活」的前提：
--   1. deliverables   —— 要交出去的东西。右边全是没定的，左边全是定了的，
--                        中间只有一个动作：定稿。所以 status 只有 draft | final。
--   2. pursuit_threads —— 一条线登记它认领的 Gmail thread。同步只拉登记过的，
--                        永远不遍历信箱。
--   3. attachments    —— 邮件附件落地。CultureHub 那份 LOA 现在只存在于一封
--                        Gmail 里，那封信一删，合同就没了。
--
-- 护栏（结构性的）：
--   Fairwind 拿到的写口只有 pa_upsert_deliverable，且它**只能碰 status='draft'**——
--   已定稿的行它改不动，删不掉，也没有把 draft 变 final 的口。定稿是你的手
--   （pa_set_final，走 anon，浏览器直连）。
--   跟 0009 一样，这不是嘱咐，是函数里没有那条路径。

-- ══ 一、产出 ═══════════════════════════════════════════════════
create table if not exists producer.deliverables (
  id           uuid primary key default gen_random_uuid(),
  pursuit_id   uuid not null references producer.pursuits(id) on delete cascade,
  kind         text not null,                       -- idea|concept|statement|bio|email|form|file
  title        text not null,
  body         text,                                -- md
  -- 规则层：字数/词数/页数/大小/必填。前端自己算，实时的，不劳 AI 猜。
  -- {chars:[1000,1500]} / {words:[50,100]} / {mb:10,pages:10} / {items:[...]}
  rules        jsonb   not null default '{}'::jsonb,
  status       text    not null default 'draft',    -- draft | final
  finalized_at timestamptz,
  -- 挡住了就明说挡在哪，而且点得回中栏那句话
  blocked_by   text,
  blocked_ref  uuid references producer.pursuit_messages(id) on delete set null,
  -- 产出之间的次序：作品构想没定稿，概念文本就在等它
  depends_on   uuid references producer.deliverables(id) on delete set null,
  -- 料从哪来（"档案里的英文 bio，一字未改"）+ 起自哪条消息
  source       text,
  source_msg   uuid references producer.pursuit_messages(id) on delete set null,
  due          date,
  meta         jsonb   not null default '{}'::jsonb, -- {gmail_draft_id, form_url, …}
  created_by   text    not null default 'fairwind',  -- fairwind | you | rule
  sort         int     not null default 100,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint deliverables_status_chk check (status in ('draft','final'))
);
create index if not exists deliverables_pid_idx on producer.deliverables (pursuit_id, status, sort);

drop trigger if exists deliverables_touch on producer.deliverables;
create trigger deliverables_touch before update on producer.deliverables
  for each row execute function producer.touch_updated_at();

comment on column producer.deliverables.status is 'draft=右栏在改 / final=左栏定稿。没有第三种';
comment on column producer.deliverables.blocked_by is '挡在哪句话上（人话），blocked_ref 指回那条消息';

-- ══ 二、邮件线索 ═══════════════════════════════════════════════
create table if not exists producer.pursuit_threads (
  pursuit_id      uuid not null references producer.pursuits(id) on delete cascade,
  gmail_thread_id text not null,
  last_history_id text,                              -- 上次同步到哪，下次只拉之后的
  last_synced_at  timestamptz,
  added_by        text not null default 'you',       -- you | fairwind
  created_at      timestamptz not null default now(),
  primary key (pursuit_id, gmail_thread_id)
);

-- ══ 三、附件 ═══════════════════════════════════════════════════
create table if not exists producer.attachments (
  id          uuid primary key default gen_random_uuid(),
  pursuit_id  uuid not null references producer.pursuits(id) on delete cascade,
  filename    text not null,
  mime        text,
  bytes       bigint,
  storage_key text,                                  -- Supabase Storage；先可空
  from_msg    uuid references producer.pursuit_messages(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists attachments_pid_idx on producer.attachments (pursuit_id);

-- ══ 四、消息：原文 + 去重 ═══════════════════════════════════════
-- meta->>'gmail_id' 现在是 jsonb 里的一个键，插两次没人拦。提成列 + 唯一索引，
-- 让「同一封信进两次」变成数据库层面做不到的事。
alter table producer.pursuit_messages
  add column if not exists gmail_message_id text,
  add column if not exists body_raw         text;   -- 原文。先落原文，后写摘要

-- 回填现有 23 行（20 封邮件 + 3 条带 gmail_id 的备注）。一行都不能丢。
update producer.pursuit_messages
   set gmail_message_id = meta->>'gmail_id'
 where meta ? 'gmail_id' and gmail_message_id is null;

-- 唯一性按 (线, 信) 而不是全局：同一封信理论上可能同时属于两条线，
-- 但同一条线里绝不该出现两次。
create unique index if not exists pm_gmail_uniq
  on producer.pursuit_messages (pursuit_id, gmail_message_id)
  where gmail_message_id is not null;

comment on column producer.pursuit_messages.body_raw is '邮件原文。Gmail 里的信你可能删，库里这份是凭据';

-- ══ 五、读面 ═══════════════════════════════════════════════════
-- 注意：整个 app 走 anon，没有登录。所以这些视图里的私人内容（邮件正文、
-- 关系记忆）anon 都读得到——这是 app 今天既有的姿势（v_pa_pursuit_messages
-- 早就把邮件摘要开给 anon 了），这一刀不改它，但记在这儿。要收紧是另一刀。
create or replace view public.v_pa_deliverables as
  select id, pursuit_id, kind, title, body, rules, status, finalized_at,
         blocked_by, blocked_ref, depends_on, source, source_msg, due, meta,
         created_by, sort, created_at, updated_at
    from producer.deliverables
   order by sort, created_at;

grant select on public.v_pa_deliverables to anon, authenticated, service_role;

-- 加两列在末尾——Postgres 允许 create or replace 追加列，前面的列名/顺序没动
create or replace view public.v_pa_pursuit_messages as
  select id, pursuit_id, role, kind, content, meta, created_at,
         gmail_message_id, body_raw
    from producer.pursuit_messages;

grant select on public.v_pa_pursuit_messages to anon, authenticated, service_role;

create or replace view public.v_pa_attachments as
  select id, pursuit_id, filename, mime, bytes, storage_key, from_msg, created_at
    from producer.attachments;

grant select on public.v_pa_attachments to anon, authenticated, service_role;

-- ══ 六、Fairwind 的口（service_role only）════════════════════════
-- 建 / 改一份草稿。三条硬约束，都在函数里，不在提示词里：
--   · 只能碰自己这条线（p_pursuit_id 对不上就拒）
--   · 只能碰 status='draft'（已定稿的改不动）
--   · 建出来的一律是 draft，没有把它变 final 的参数
create or replace function public.pa_upsert_deliverable(
  p_pursuit_id  uuid,
  p_kind        text,
  p_title       text,
  p_id          uuid    default null,
  p_body        text    default null,
  p_rules       jsonb   default null,
  p_blocked_by  text    default null,
  p_blocked_ref uuid    default null,
  p_depends_on  uuid    default null,
  p_source      text    default null,
  p_source_msg  uuid    default null,
  p_due         date    default null,
  p_meta        jsonb   default null,
  p_created_by  text    default 'fairwind'
)
returns jsonb
language plpgsql
security definer
set search_path = public, producer
as $$
declare r producer.deliverables;
begin
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'title 不能为空';
  end if;
  if p_created_by not in ('fairwind','you','rule') then
    raise exception 'created_by 只能是 fairwind|you|rule，收到 %', p_created_by;
  end if;

  if p_id is null then
    insert into producer.deliverables
      (pursuit_id, kind, title, body, rules, blocked_by, blocked_ref,
       depends_on, source, source_msg, due, meta, created_by)
    values
      (p_pursuit_id, p_kind, p_title, p_body, coalesce(p_rules, '{}'::jsonb),
       p_blocked_by, p_blocked_ref, p_depends_on, p_source, p_source_msg,
       p_due, coalesce(p_meta, '{}'::jsonb), p_created_by)
    returning * into r;
    return to_jsonb(r);
  end if;

  select * into r from producer.deliverables where id = p_id;
  if not found then
    raise exception 'no deliverable: %', p_id;
  end if;
  if r.pursuit_id <> p_pursuit_id then
    raise exception '这份产出不属于这条线';           -- 关在一条线里
  end if;
  if r.status = 'final' then
    raise exception '已定稿，改不了。要改先取消定稿';  -- 定稿是你的手
  end if;

  update producer.deliverables set
    kind        = coalesce(p_kind, kind),
    title       = coalesce(nullif(btrim(p_title), ''), title),
    body        = coalesce(p_body, body),
    rules       = coalesce(p_rules, rules),
    blocked_by  = coalesce(p_blocked_by, blocked_by),
    blocked_ref = coalesce(p_blocked_ref, blocked_ref),
    depends_on  = coalesce(p_depends_on, depends_on),
    source      = coalesce(p_source, source),
    source_msg  = coalesce(p_source_msg, source_msg),
    due         = coalesce(p_due, due),
    meta        = coalesce(p_meta, meta)
  where id = p_id
  returning * into r;

  return to_jsonb(r);
end
$$;

-- 收一封信。按 (线, gmail_message_id) 去重——同一封插两次静默跳过，
-- 返回里带 inserted 让调用方知道到底进没进。
-- created_at 必须能指定：那是真实发信时间，不是入库时间。
create or replace function public.pa_add_email(
  p_pursuit_id       uuid,
  p_role             text,
  p_gmail_message_id text,
  p_content          text,
  p_body_raw         text        default null,
  p_meta             jsonb       default null,
  p_created_at       timestamptz default null,
  p_kind             text        default 'email'
)
returns jsonb
language plpgsql
security definer
set search_path = public, producer
as $$
declare r producer.pursuit_messages; ins boolean := false;
begin
  -- 邮件只有两边：机构发的，和你发的。（pa_add_message 那套 role 是给对话用的）
  if p_role not in ('org', 'artist') then
    raise exception 'email 的 role 只能是 org|artist，收到 %', p_role;
  end if;
  if coalesce(btrim(p_gmail_message_id), '') = '' then
    raise exception 'gmail_message_id 不能为空——没有它就没法去重';
  end if;

  insert into producer.pursuit_messages
    (pursuit_id, role, kind, content, body_raw, gmail_message_id, meta, created_at)
  values
    (p_pursuit_id, p_role, p_kind, p_content, p_body_raw, p_gmail_message_id,
     coalesce(p_meta, '{}'::jsonb), coalesce(p_created_at, now()))
  on conflict (pursuit_id, gmail_message_id) where gmail_message_id is not null
  do nothing
  returning * into r;

  if found then
    ins := true;
  else
    select * into r from producer.pursuit_messages
     where pursuit_id = p_pursuit_id and gmail_message_id = p_gmail_message_id;
  end if;

  return jsonb_build_object('inserted', ins, 'message', to_jsonb(r));
end
$$;

-- 认领一个 thread / 记下同步到哪
create or replace function public.pa_link_thread(
  p_pursuit_id uuid,
  p_thread_id  text,
  p_added_by   text default 'you'
)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
begin
  insert into producer.pursuit_threads (pursuit_id, gmail_thread_id, added_by)
  values (p_pursuit_id, p_thread_id, p_added_by)
  on conflict (pursuit_id, gmail_thread_id) do nothing;
end
$$;

create or replace function public.pa_touch_thread(
  p_pursuit_id uuid,
  p_thread_id  text,
  p_history_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
begin
  update producer.pursuit_threads
     set last_synced_at = now(),
         last_history_id = coalesce(p_history_id, last_history_id)
   where pursuit_id = p_pursuit_id and gmail_thread_id = p_thread_id;
end
$$;

-- ══ 七、你的手（anon，浏览器直连）═══════════════════════════════
-- 定稿 / 取消定稿。Fairwind 没有这个口。
create or replace function public.pa_set_final(p_id uuid, p_final boolean)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
begin
  update producer.deliverables
     set status = case when p_final then 'final' else 'draft' end,
         finalized_at = case when p_final then now() else null end
   where id = p_id;
  if not found then raise exception 'no deliverable: %', p_id; end if;
end
$$;

-- 你在页面上改草稿的正文 / 标题
create or replace function public.pa_edit_deliverable(
  p_id uuid, p_title text default null, p_body text default null
)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
declare st text;
begin
  select status into st from producer.deliverables where id = p_id;
  if not found then raise exception 'no deliverable: %', p_id; end if;
  if st = 'final' then raise exception '已定稿，先取消定稿再改'; end if;

  update producer.deliverables
     set title = coalesce(nullif(btrim(p_title), ''), title),
         body  = coalesce(p_body, body)
   where id = p_id;
end
$$;

-- 你自己新建一份空产出
create or replace function public.pa_new_deliverable(
  p_pursuit_id uuid, p_kind text default 'file', p_title text default '未命名'
)
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select public.pa_upsert_deliverable(
    p_pursuit_id := p_pursuit_id, p_kind := p_kind,
    p_title := p_title, p_created_by := 'you');
$$;

-- 删。只能删草稿——定稿的东西要先取消定稿，免得一按就没。
create or replace function public.pa_delete_deliverable(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
declare st text;
begin
  select status into st from producer.deliverables where id = p_id;
  if not found then raise exception 'no deliverable: %', p_id; end if;
  if st = 'final' then raise exception '定稿的删不了，先取消定稿'; end if;
  delete from producer.deliverables where id = p_id;
end
$$;

-- ══ 八、谁能调 ═════════════════════════════════════════════════
-- Fairwind（service_role）：只能建/改草稿、收信、认领 thread
revoke all on function public.pa_upsert_deliverable(uuid,text,text,uuid,text,jsonb,text,uuid,uuid,text,uuid,date,jsonb,text) from public, anon, authenticated;
revoke all on function public.pa_add_email(uuid,text,text,text,text,jsonb,timestamptz,text) from public, anon, authenticated;
revoke all on function public.pa_link_thread(uuid,text,text) from public, anon, authenticated;
revoke all on function public.pa_touch_thread(uuid,text,text) from public, anon, authenticated;
grant execute on function public.pa_upsert_deliverable(uuid,text,text,uuid,text,jsonb,text,uuid,uuid,text,uuid,date,jsonb,text) to service_role;
grant execute on function public.pa_add_email(uuid,text,text,text,text,jsonb,timestamptz,text) to service_role;
grant execute on function public.pa_link_thread(uuid,text,text) to service_role;
grant execute on function public.pa_touch_thread(uuid,text,text) to service_role;

-- 你的手（anon）：定稿、取消定稿、改草稿、新建、删草稿
revoke all on function public.pa_set_final(uuid,boolean) from public;
revoke all on function public.pa_edit_deliverable(uuid,text,text) from public;
revoke all on function public.pa_new_deliverable(uuid,text,text) from public;
revoke all on function public.pa_delete_deliverable(uuid) from public;
grant execute on function public.pa_set_final(uuid,boolean) to anon, authenticated, service_role;
grant execute on function public.pa_edit_deliverable(uuid,text,text) to anon, authenticated, service_role;
grant execute on function public.pa_new_deliverable(uuid,text,text) to anon, authenticated, service_role;
grant execute on function public.pa_delete_deliverable(uuid) to anon, authenticated, service_role;

-- ══ 九、Fairwind 的上下文加上产出和 thread ══════════════════════
-- 不加的话它看不见右栏已经有什么，会重复建。
-- 照 0025 的规矩：create or replace 必须整段重写，漏掉 security definer
-- 或 search_path 会悄悄改掉权限模型且不报错。
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
    'deliverables', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.sort, d.created_at)
      from producer.deliverables d where d.pursuit_id = p_pursuit_id
    ), '[]'::jsonb),
    'threads', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at)
      from producer.pursuit_threads t where t.pursuit_id = p_pursuit_id
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
