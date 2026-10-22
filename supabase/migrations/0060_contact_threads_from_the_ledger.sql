-- 一个人有哪几条邮件往来：**查账本，不问模型。**
--
-- 犯过的错：给「按人收信」加过一段用模型去 Gmail search_threads 找 thread 的
-- 逻辑。那正是 brain/mail 这条机械管线要消灭的东西——auth.js 开头就写着
-- 「连接器的工具只有模型能调，于是每取一批信都要花一次模型往返，
--   抓取和理解焊死在一起」。
--
-- 答案早就在库里：mail_headers 是全量信头账本（纯 HTTP 抓的）。
-- 一个人有哪些地址 → contact_emails，那些地址在哪些 thread 里 → mail_headers。
-- 两张表一次 join 就完了。找信这件事**根本不需要判断**，判断只在
-- 「这个地址是谁」那一步，而那一步 address_verdicts 已经做过了。
create or replace function public.pa_contact_thread_ids(p_contact_id uuid)
returns jsonb language sql security definer set search_path = public, producer as $fn$
  select coalesce(jsonb_agg(distinct h.gmail_thread_id), '[]'::jsonb)
    from producer.mail_headers h
   where h.gmail_thread_id is not null
     and lower(h.counterpart_email) in (
       select lower(e.email) from producer.contact_emails e where e.contact_id = p_contact_id
     );
$fn$;
revoke all on function public.pa_contact_thread_ids(uuid) from public, anon, authenticated;
grant execute on function public.pa_contact_thread_ids(uuid) to service_role;

comment on function public.pa_contact_thread_ids(uuid) is
  '一个人名下所有 Gmail thread id，从信头账本查出来。**零模型调用**——找信是机械活，判断只发生在「这个地址是谁」那一步，而那一步已经做过了';
