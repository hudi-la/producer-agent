-- Producer Agent — 标签在收信时就记下来
--
-- 病：自查第一条「每封信头都核过 Gmail 标签」，**每来一封新信就会挂**。
--     因为审计表是我手动扫全库填的 —— 而那要靠谁记得去扫。
--
-- 药：classify 那一步手里本来就有 labelIds（四道闸就是拿它判的），
--     一路带到 pa_mail_headers_upsert，顺手写进 mail_label_audit。
--     **账本从此是自审的。**
--
-- 注意：这一支是在 0054 的原文上**只加了记标签那一段**。
--   原文里那几样护栏一个字没动，尤其是 `ok` 那个 CTE ——
--   「缺关键字段的整行不写。宁可这一封没进来，也不要它进来之后归错人。」
--   （第一次改这个函数时我没读原文就重写了，把归一化和那道闸全丢了。）
--
-- 开发文档：docs/dev/mail-classification.md

create or replace function public.pa_mail_headers_upsert(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
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
      -- 新加的只有这一行
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
    on conflict (gmail_message_id) do update
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
    on conflict (gmail_message_id) do update
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
end $$;

revoke all on function public.pa_mail_headers_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.pa_mail_headers_upsert(jsonb) to service_role;
