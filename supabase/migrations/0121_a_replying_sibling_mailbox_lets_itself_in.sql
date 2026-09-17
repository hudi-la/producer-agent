-- Producer Agent — 同机构的另一个信箱回到你的线里，自己进门
--
-- 真事（Descanso，2026-08-25）：Francesca 从 programs@ 回了你发给
-- visitorcenter@ 的提案（RFC 串着），一来一回三封 —— 全堵在账本里。
-- programs@ 是新地址，判成了「共享信箱 · 业务」，但没登记 → 搬运不放
-- → 卡片、判断、通知一概没发生。一封**要回的来信**卡在门外还不出声。
--
-- 这情形是规则级证据，不该劳他点头：
--   ① 判定是 shared_box 且业务相关（classify 判过的）
--   ② 同域名下这机构**已有**登记过的信箱（机构是谁不用猜）
--   ③ 它的信就回在**已经归了线的信串**里（在跟你谈的正是那件事）
-- 三样齐了 → 自动登记成该机构的共享信箱。搬运在下一步接手。
--
-- 「人」不走这条 —— 名片该谁点头还是谁点头（认错人比不认更麻烦）。

create or replace function public.pa_adopt_replying_mailboxes()
returns table (email text, org text)
language plpgsql security definer set search_path = public, producer as $$
declare r record;
begin
  for r in
    select distinct h.counterpart_email as em,
           (select b.org from producer.org_mailboxes b
             where split_part(b.email, '@', 2) = split_part(h.counterpart_email, '@', 2)
             limit 1) as known_org
      from producer.mail_headers h
      join producer.address_verdicts v on v.email = h.counterpart_email
     where h.direction = 'in' and not h.is_draft
       and v.verdict = 'shared_box' and coalesce(v.business, false)
       and not exists (select 1 from producer.org_mailboxes b
                        where b.email = h.counterpart_email)
       and not exists (select 1 from producer.contact_emails e
                        where lower(e.email) = h.counterpart_email)
       -- ② 同域名有登记过的信箱
       and exists (select 1 from producer.org_mailboxes b
                    where split_part(b.email, '@', 2) = split_part(h.counterpart_email, '@', 2))
       -- ③ 回在已经归了线的信串里
       and exists (select 1 from public.v_pa_pursuit_mail pv
                   where pv.on_this_line
                     and pv.gmail_thread_id = h.gmail_thread_id)
  loop
    insert into producer.org_mailboxes (org, email, label, notes)
    values (r.known_org, r.em, '共享信箱',
            '自动登记：同机构、共享信箱判定、回在已归线的信串里（0115）')
    on conflict do nothing;
    email := r.em; org := r.known_org;
    return next;
  end loop;
end $$;

revoke all on function public.pa_adopt_replying_mailboxes() from public;
grant execute on function public.pa_adopt_replying_mailboxes() to anon, authenticated, service_role;
