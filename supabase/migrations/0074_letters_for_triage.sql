-- Producer Agent — 要判的那几封信，取出来
--
-- 病：判信那条路第一次真跑，回的是 {"judged":0,"failed":0}——**判了 0 封
--     还不报错**，最像「这批没什么可判的」，其实是一封都没取到。
--
-- 病根：brain 里写成了 db.from('pursuit_messages')。可 producer schema
--     **没进 Supabase 的 Exposed schemas**（共用项目，不动全局设置），
--     那一句打的是 public.pursuit_messages —— 不存在的表，返回空。
--     server.js 开头第 60 行就写着这条规矩，我没照着做。
--
-- 药：照这个仓库一直以来的做法，走 public 里的 security definer 函数。
--
-- 上游：docs/specs/2026-08-18-notifications-design.md 第五节

create or replace function public.pa_letters_for_triage(p_ids text[])
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',      m.gmail_message_id,
           'from',    coalesce(h.from_name, h.from_email, m.counterpart_email, '对方'),
           'subject', coalesce(h.subject, ''),
           -- 原文优先。body_raw 是收信时落的原文，content 是摘要——
           -- 判「要不要回」得看他到底说了什么，不能看别人替他缩过的那句。
           'body',    left(coalesce(m.body_raw, m.content, ''), 1200),
           'at',      to_char(m.created_at, 'YYYY-MM-DD')
         ) order by m.created_at), '[]'::jsonb)
    from producer.pursuit_messages m
    left join producer.mail_headers h on h.gmail_message_id = m.gmail_message_id
   where m.gmail_message_id = any(p_ids)
     and m.deleted_at is null
$$;

comment on function public.pa_letters_for_triage(text[]) is
  '按 gmail_message_id 取信，交给模型判「要不要回」。走 public 是因为 producer schema 没 expose';

grant execute on function public.pa_letters_for_triage(text[])
  to anon, authenticated, service_role;
