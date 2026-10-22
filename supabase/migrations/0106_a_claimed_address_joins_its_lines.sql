-- Producer Agent — 认领一个地址，人跟着信一起归位
--
-- 真事（2026-08-20）：adavi290@asu.edu 的信早就通过 RFC 认亲挂在 ASU
-- 线上了 —— 于是它不算孤儿信，每 5 分钟的归属判断根本不看它，
-- 认领之后也没有任何东西把这个**人**挂成线的相关方。他手动挂的。
--
-- 缺的是一条纯规则：**信在哪条线上，认领时人就挂到哪条线上。**
-- 证据确凿（信就在线上），不用模型、不用等下一轮。
-- 信不在任何线上的那种，照旧走 attributePass 的模型判断（那机制一直在，
-- 认领之后它就有卡可挂了）。

create or replace function public.pa_attach_address_lines(
  p_email text,
  p_contact_id uuid default null,   -- 认领成人 → 给这个
  p_mailbox text default null       -- 认领成共享信箱 → 给这个
) returns text[]                    -- 挂上的线的标题，给界面报一声
language plpgsql security definer set search_path = public, producer as $$
declare v_titles text[] := '{}'; r record;
begin
  if p_contact_id is null and p_mailbox is null then
    raise exception '要么给人（contact_id）要么给信箱（mailbox），不能都空';
  end if;

  for r in
    select distinct v.pursuit_id, p.title
      from producer.mail_headers h
      join producer.pursuit_messages m
        on m.gmail_message_id = h.gmail_message_id and m.deleted_at is null
      join public.v_pa_pursuit_mail v on v.id = m.id and v.on_this_line
      join producer.pursuits p on p.id = v.pursuit_id
     where h.counterpart_email = lower(btrim(p_email))
       and not exists (   -- 已经挂过的不重挂
         select 1 from producer.pursuit_parties pp
          where pp.pursuit_id = v.pursuit_id
            and (pp.contact_id = p_contact_id
              or pp.mailbox_email = lower(btrim(p_mailbox))))
  loop
    perform public.pa_attach_party(
      r.pursuit_id, p_contact_id, lower(btrim(p_mailbox)),
      '认领地址时跟着信归位（信本来就在这条线上）', 'rule');
    v_titles := v_titles || r.title;
  end loop;

  return v_titles;
end $$;

revoke all on function public.pa_attach_address_lines(text, uuid, text) from public;
grant execute on function public.pa_attach_address_lines(text, uuid, text)
  to anon, authenticated, service_role;
