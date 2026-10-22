-- 「机构里另一个人回了信」——从根上治，不靠一次次手工挂。
--
-- ══ 真事 ══════════════════════════════════════════════════════
-- 你发给 info@pam.usc.edu，Cristina 用 ch45852@usc.edu 回你。她既不在
-- 那条线的班底里，Gmail 也没把两封归成同一串（她另起了一封新信），
-- 于是那封回信落在她自己名下，PAM 那条线上什么都没有。
--
-- ══ 大部分情况机械就能解决 ════════════════════════════════════
-- 一封真正「点回复」发出的邮件，**无论换成哪个地址发**，信头里都带着
-- In-Reply-To 和 References，指向原信的 Message-ID。这是 RFC 5322
-- 定下的事实，不是猜出来的。
--
-- 所以只要把这三个头存下来，「这封回的是我哪封信」就变成一次 join，
-- 零成本、精确、而且以后永远有效。Gmail 自己的 threadId 在跨地址、
-- 跨客户端的时候并不总是把它们归成一串——RFC 头比它可靠。
--
-- 剩下的（像 Cristina 那样另起一封新信的）才交给模型看主题和机构。
alter table producer.mail_headers add column if not exists message_id  text;
alter table producer.mail_headers add column if not exists in_reply_to text;
alter table producer.mail_headers add column if not exists refs        text[];

-- 「谁回的我」靠这两个索引：拿我发出去那封的 message_id，反查谁引用了它
create index if not exists mail_headers_msgid_idx
  on producer.mail_headers (message_id) where message_id is not null;
create index if not exists mail_headers_irt_idx
  on producer.mail_headers (in_reply_to) where in_reply_to is not null;
create index if not exists mail_headers_refs_idx
  on producer.mail_headers using gin (refs) where refs is not null;

comment on column producer.mail_headers.refs is
  'References 头：这封信引用的全部祖先 Message-ID。跨地址回信全靠它认亲——Gmail 的 threadId 在换地址/换客户端时不总是归成一串';

-- 收信时一起塞进来
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
      coalesce(array(select btrim(x #>> '{}') from jsonb_array_elements(coalesce(r->'refs', '[]'::jsonb)) x), '{}') as refs
    from jsonb_array_elements(p_rows) r
  ), ok as (
    select * from incoming
     where gmail_message_id is not null and gmail_message_id <> ''
       and counterpart_email like '%@%'
       and direction in ('in', 'out')
       and sent_at is not null
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
       -- 老行是 0054 之前入库的，这三栏还空着。补上，别让它们永远缺着。
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
