-- Producer Agent — 没有一把键还记得单人时代
--
-- workshop-edition(2026-08-25)。这支来自他的要求:只参考单人版的
-- **功能效果**,从零重新推导架构,推导跟现状不一致的地方以推导为准。
-- 推导和对账在 docs/specs/2026-08-25-architecture-from-requirements.md;
-- 这支修掉重扫出的三块化石(D1–D3)。
--
-- D1 gmail id 当全局主键(mail_headers / mail_label_audit / letter_verdicts,
--    外加 pursuit_messages 的孤儿唯一索引)。之前拿「跨信箱撞 id 概率是
--    天文数字」当理由留着——那是继承的辩护,不是推导的结论。推导说:
--    来自外部世界的自然键,租户内唯一,绝不全局唯一。
-- D2 singleton 列。多租户里没有「全库一行」这个概念。
-- D3 stage_backup_0015,他个人史里一次改造的回滚备份,不是功能。
--
-- 一律 nulls not distinct:无主行(owner 为 null,个人版 service 老路)
-- 之间保持旧的全局唯一语义,一字不变。
-- 规矩重申:重定义 pa_* 不写 security definer(0118 起)。

-- ── D1 · mail_headers:主键换成 (owner, gmail_message_id) ──
-- letter_verdicts 有条外键指着旧主键,先摘,后面再按复合键挂回去。
do $$
declare fk text;
begin
  select conname into fk from pg_constraint
   where conrelid = 'producer.letter_verdicts'::regclass and contype = 'f'
     and confrelid = 'producer.mail_headers'::regclass;
  if fk is not null then
    execute format('alter table producer.letter_verdicts drop constraint %I', fk);
  end if;
end $$;

alter table producer.mail_headers drop constraint if exists mail_headers_pkey;
alter table producer.mail_headers
  add constraint mail_headers_tenant_gmid unique nulls not distinct (owner, gmail_message_id);
-- service 老路按 gmid 单列查(owner 打头的复合索引帮不上),留一根普通索引
create index if not exists mail_headers_gmid_idx on producer.mail_headers (gmail_message_id);

alter table producer.mail_label_audit drop constraint if exists mail_label_audit_pkey;
alter table producer.mail_label_audit
  add constraint mail_label_audit_tenant_gmid unique nulls not distinct (owner, gmail_message_id);
create index if not exists mail_label_audit_gmid_idx on producer.mail_label_audit (gmail_message_id);

alter table producer.letter_verdicts drop constraint if exists letter_verdicts_pkey;
alter table producer.letter_verdicts
  add constraint letter_verdicts_tenant_gmid unique nulls not distinct (owner, gmail_message_id);
create index if not exists letter_verdicts_gmid_idx on producer.letter_verdicts (gmail_message_id);
-- 外键挂回去,按复合键:一个人的判定跟着他自己那封信走
alter table producer.letter_verdicts
  add constraint letter_verdicts_header_fk
  foreign key (owner, gmail_message_id)
  references producer.mail_headers (owner, gmail_message_id) on delete cascade;

-- pursuit_messages 那根「无主邮件行」的唯一索引,同样带上租户
drop index if exists producer.pm_gmail_owner_uniq;
create unique index pm_gmail_owner_uniq
  on producer.pursuit_messages (owner, gmail_message_id,
    coalesce(pursuit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid))
  nulls not distinct
  where gmail_message_id is not null;

-- ── D1 · 两个写入函数的 conflict 目标跟上 ──────────────────

create or replace function public.pa_judge_letter(p_gmail_message_id text, p_needs_reply boolean, p_not_before date, p_why text)
 returns boolean
 language plpgsql
 set search_path to 'public', 'producer'
as $function$
begin
  -- 信不在账本里就不判 —— 不许凭空造一行判定出来
  if not exists (select 1 from producer.mail_headers
                  where gmail_message_id = p_gmail_message_id) then
    return false;
  end if;
  insert into producer.letter_verdicts
              (gmail_message_id, needs_reply, not_before, why)
       values (p_gmail_message_id, p_needs_reply, p_not_before,
               coalesce(nullif(trim(p_why), ''), '（没说理由）'))
  on conflict (owner, gmail_message_id) do update
     set needs_reply = excluded.needs_reply,
         not_before  = excluded.not_before,
         why         = excluded.why,
         judged_at   = now();
  return true;
end $function$;

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
           then array(select x #>> '{}' from jsonb_array_elements(r->'labels') x) end as labels
    from jsonb_array_elements(p_rows) r
  ), ok as (
    -- 缺关键字段的整行不写。宁可这一封没进来，也不要它进来之后归错人。
    select * from incoming
     where gmail_message_id is not null and gmail_message_id <> ''
       and counterpart_email like '%@%'
       and direction in ('in', 'out')
       and sent_at is not null
  ), 记标签 as (
    -- 有标签就记，没有不拦路（老数据、测试桩没有 labelIds）
    insert into producer.mail_label_audit (gmail_message_id, labels, gone)
    select gmail_message_id, labels, false from ok where labels is not null
    on conflict (owner, gmail_message_id) do update
       set labels = excluded.labels, gone = false, checked_at = now()
    returning 1
  ), ins as (
    insert into producer.mail_headers (
      gmail_message_id, account_id, gmail_thread_id, from_email, from_name,
      to_emails, cc_emails, subject, sent_at, counterpart_email, direction, bulk,
      message_id, in_reply_to, refs)
    select gmail_message_id, account_id, gmail_thread_id, from_email, from_name,
           to_emails, cc_emails, subject, sent_at, counterpart_email, direction, bulk,
           message_id, in_reply_to, refs
      from ok
    on conflict (owner, gmail_message_id) do update
       set message_id  = coalesce(excluded.message_id,  producer.mail_headers.message_id),
           in_reply_to = coalesce(excluded.in_reply_to, producer.mail_headers.in_reply_to),
           refs        = case when coalesce(array_length(excluded.refs, 1), 0) > 0
                              then excluded.refs else producer.mail_headers.refs end
    returning (xmax = 0) as fresh
  )
  select count(*) filter (where fresh) into n_ins from ins;

  return jsonb_build_object(
    'given',   jsonb_array_length(p_rows),
    'written', n_ins,
    'skipped', jsonb_array_length(p_rows) - n_ins);
end $function$;

-- ── D2 · singleton 退场:多租户里没有「全库一行」──────────

create or replace function public.pa_set_profile(p_name text default null::text, p_website text default null::text, p_data jsonb default null::jsonb)
 returns void
 language plpgsql
 set search_path to 'public', 'producer'
as $function$
begin
  -- 不带 where:invoker + RLS 本身就把更新限定在「你的那一行」
  update producer.profile
     set name       = coalesce(nullif(btrim(p_name), ''), name),
         website    = coalesce(nullif(btrim(p_website), ''), website),
         data       = case when p_data is null then data
                           else coalesce(data, '{}'::jsonb) || p_data end,
         updated_at = now();
  if not found then raise exception '库里没有 profile'; end if;
end
$function$;

create or replace function public.pa_set_voice(p_agent_name text default null::text, p_persona text default null::text, p_letter_rule text default null::text, p_form_rule text default null::text, p_judge_rule text default null::text)
 returns void
 language plpgsql
 set search_path to 'public', 'producer'
as $function$
begin
  update producer.voice
     set agent_name  = case when p_agent_name  is null then agent_name  else nullif(btrim(p_agent_name),  '') end,
         persona     = case when p_persona     is null then persona     else nullif(btrim(p_persona),     '') end,
         letter_rule = case when p_letter_rule is null then letter_rule else nullif(btrim(p_letter_rule), '') end,
         form_rule   = case when p_form_rule   is null then form_rule   else nullif(btrim(p_form_rule),   '') end,
         judge_rule  = case when p_judge_rule  is null then judge_rule  else nullif(btrim(p_judge_rule),  '') end,
         updated_at  = now();
end
$function$;

alter table producer.voice drop constraint if exists voice_singleton_true;
alter table producer.profile drop column if exists singleton;
alter table producer.voice   drop column if exists singleton;

-- ── D3 · 个人史的备份表:空则删 ────────────────────────────
-- 他的生产库里这张表非空(2026-08 stages 改造的回滚保险),留;
-- 任何新库里它生来是空的,不该存在。
do $$
declare n int;
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'producer' and c.relname = 'stage_backup_0015') then
    -- 表引用走动态 SQL:表要是不存在,静态引用会让整个块在解析期就炸
    execute 'select count(*) from (select 1 from producer.stage_backup_0015 limit 1) x' into n;
    if n = 0 then execute 'drop table producer.stage_backup_0015'; end if;
  end if;
end $$;
