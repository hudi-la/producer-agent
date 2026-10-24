-- 0169 · 被覆盖掉的功能合回来，密钥只给服务端（2026-10-24 体检）
--
-- ⚠️ 执行顺序：**先上线 2026-10-24 那版后端**（它会优先调 pa_member_secrets_for，
--    读不到才退回老函数），**再跑这支**。反过来跑，老后端读不到设置，全员掉线。
--
-- 一、两个上下文函数带回「提醒栏」（state）。
--     0129 加的，0135（另一条分支上更早写的，重编号后排到了 0129 后面）用旧函数体整个盖掉了。
--     线上库确认没有 state：聊天时 Fairwind 一直以为「这条线不等任何事」。
--     函数体以 2026-10-23 从线上库读出的定义为准，只加 state 一项。create or replace 不动现有权限。
--
-- 二、信头写入带回署名（names）。0127 加的，0140 用旧函数体盖掉了。
--     信头构建（brain/mail/addr.js）一直在传 names，写库这一步把它丢了，
--     于是「抄送的人自动进门」每次都得回头去 Gmail 再拿一次署名。
--
-- 三、密钥只给服务端。pa_member_secrets 返回模型 key、Claude 登录令牌、Gmail 长期令牌、MCP 令牌的原文，
--     任何登录后的浏览器会话都调得动（只能拿到自己的）。新开 pa_member_secrets_for(owner) 只给 service_role，
--     老函数收回 authenticated 的执行权。
--
-- 四、安全检查器报的 7 个函数补上固定的 search_path。

-- ── 一 ────────────────────────────────────────────────────────

create or replace function public.pa_brain_context(p_pursuit_id uuid)
 returns jsonb
 language sql
 set search_path to 'public', 'producer'
as $function$
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
      where m.deleted_at is null
        and exists (select 1 from producer.pursuits p where p.id = p_pursuit_id)
        and (m.pursuit_id = p_pursuit_id or exists (
          select 1 from public.v_pa_pursuit_mail v
          where v.pursuit_id = p_pursuit_id and v.on_this_line
            and v.kind = 'email' and v.id = m.id
        ))
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
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1),
    'state', (select to_jsonb(s) from public.v_pa_state s
               where s.subject_kind = 'pursuit' and s.subject_id = p_pursuit_id limit 1)
  );
$function$;

create or replace function public.pa_brain_person_context(p_contact_id uuid)
 returns jsonb
 language sql
 set search_path to 'public', 'producer'
as $function$
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
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1),
    'state', (select to_jsonb(s) from public.v_pa_state s
               where s.subject_kind = 'contact' and s.subject_id = p_contact_id limit 1)
  );
$function$;

-- ── 二 ────────────────────────────────────────────────────────

create or replace function public.pa_mail_headers_upsert(p_rows jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare n_ins int;
begin
  with incoming as (
    select
      r->>'gmail_message_id'                                    as gmail_message_id,
      (r->>'account_id')::uuid                                  as account_id,
      r->>'gmail_thread_id'                                     as gmail_thread_id,
      lower(btrim(r->>'from_email'))                            as from_email,
      nullif(btrim(coalesce(r->>'from_name', '')), '')          as from_name,
      coalesce(array(select lower(btrim(x #>> '{}')) from jsonb_array_elements(coalesce(r->'to_emails', '[]'::jsonb)) x), '{}') as to_emails,
      coalesce(array(select lower(btrim(x #>> '{}')) from jsonb_array_elements(coalesce(r->'cc_emails', '[]'::jsonb)) x), '{}') as cc_emails,
      nullif(btrim(coalesce(r->>'subject', '')), '')            as subject,
      (r->>'sent_at')::timestamptz                              as sent_at,
      lower(btrim(r->>'counterpart_email'))                     as counterpart_email,
      r->>'direction'                                           as direction,
      coalesce((r->>'bulk')::boolean, false)                    as bulk,
      nullif(btrim(coalesce(r->>'message_id', '')), '')         as message_id,
      nullif(btrim(coalesce(r->>'in_reply_to', '')), '')        as in_reply_to,
      coalesce(array(select btrim(x #>> '{}') from jsonb_array_elements(coalesce(r->'refs', '[]'::jsonb)) x), '{}') as refs,
      case when jsonb_typeof(r->'labels') = 'array'
           then array(select x #>> '{}' from jsonb_array_elements(r->'labels') x) end as labels,
      -- 0127 加的署名，0140 弄丢了，这里合回来
      case when jsonb_typeof(r->'names') = 'object' then r->'names' end as names
    from jsonb_array_elements(p_rows) r
  ), ok as (
    select * from incoming
     where gmail_message_id is not null and gmail_message_id <> ''
       and counterpart_email like '%@%'
       and direction in ('in', 'out')
       and sent_at is not null
  ), 记标签 as (
    insert into producer.mail_label_audit (gmail_message_id, labels, gone)
    select gmail_message_id, labels, false from ok where labels is not null
    on conflict (owner, gmail_message_id) do update
       set labels = excluded.labels, gone = false, checked_at = now()
    returning 1
  ), ins as (
    insert into producer.mail_headers (
      gmail_message_id, account_id, gmail_thread_id, from_email, from_name,
      to_emails, cc_emails, subject, sent_at, counterpart_email, direction, bulk,
      message_id, in_reply_to, refs, names)
    select gmail_message_id, account_id, gmail_thread_id, from_email, from_name,
           to_emails, cc_emails, subject, sent_at, counterpart_email, direction, bulk,
           message_id, in_reply_to, refs, names
      from ok
    on conflict (owner, gmail_message_id) do update
       set message_id  = coalesce(excluded.message_id,  producer.mail_headers.message_id),
           in_reply_to = coalesce(excluded.in_reply_to, producer.mail_headers.in_reply_to),
           refs        = case when coalesce(array_length(excluded.refs, 1), 0) > 0
                              then excluded.refs else producer.mail_headers.refs end,
           -- 已有的署名不覆盖
           names       = coalesce(producer.mail_headers.names, excluded.names)
    returning (xmax = 0) as fresh
  )
  select count(*) filter (where fresh) into n_ins from ins;

  return jsonb_build_object(
    'given',   jsonb_array_length(p_rows),
    'written', n_ins,
    'skipped', jsonb_array_length(p_rows) - n_ins);
end $function$;

-- ── 三 ────────────────────────────────────────────────────────

create or replace function public.pa_member_secrets_for(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, producer
as $$
  select jsonb_build_object(
    'provider',            s.provider,
    'api_key',             s.api_key,
    'oauth_token',         s.oauth_token,
    'openai_key',          s.openai_key,
    'gemini_key',          s.gemini_key,
    'model',               s.model,
    'model_cheap',         s.model_cheap,
    'lang',                s.lang,
    'judgments_enabled',   s.judgments_enabled,
    'modules',             s.modules,
    'mcp_token',           s.mcp_token,
    'onboarded',           s.onboarded,
    'gmail_address',       s.gmail_address,
    'gmail_refresh_token', s.gmail_refresh_token,
    'updated_at',          s.updated_at
  )
    from producer.member_settings s
   where s.owner = p_owner
$$;

revoke all on function public.pa_member_secrets_for(uuid) from public, anon, authenticated;
grant execute on function public.pa_member_secrets_for(uuid) to service_role;

revoke execute on function public.pa_member_secrets() from authenticated;

-- ── 四 ────────────────────────────────────────────────────────

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname, p.proname) in (('public', 'pa_public_mail_domains'), ('producer', 'touch_updated_at'),
             ('producer', 'demo_guard'), ('producer', 'first_para'), ('producer', 'base_tables_of'),
             ('producer', 'pulse_wire'), ('producer', 'wire_card_view'))
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, producer', f);
  end loop;
end $$;
