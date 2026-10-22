-- 「机构里另一个人回了信」：机械层。
--
-- ══ 判据 ══════════════════════════════════════════════════════
-- 一封回信的 References / In-Reply-To 指向我发出去的某封信的 Message-ID。
-- 那封我发出去的信，收件人是某条线的班底 → **这封回信就是那条线的事**，
-- 不管回信的人是谁、用的哪个地址。
--
-- 这是 RFC 5322 的事实，不是猜。零成本，精确，而且以后永远有效。
--
-- 真数据：3415 封里 229 封来信能精确追到「回的是我哪一封」，其中 25 封
-- 是换了个地址/换了个人回的——包括 dpesenti@phs-spca.org 回我发给
-- info@phs-spca.org 的信（跟 PAM 那个一模一样的形状）。
--
-- ══ 跳过退信 ══════════════════════════════════════════════════
-- 那 25 封里有 7 封是 mailer-daemon 的投递失败通知。它们技术上确实
-- 「引用了我那封信」，但把它们当成「对方回复了」会让球权判错——
-- 卡上会显示「他回你了」，而其实是信根本没送到。
--
-- 所以只认判定为 person / shared_box 的，或者还没判过的（那些会去
-- 「等你点头」）。判成 machine / bulk 的一律不算回信。
create or replace function public.pa_link_replies()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare n int := 0;
begin
  with 我发出的 as (
    -- 我发给某条线班底的信。班底可能是人，也可能是机构共享信箱。
    select o.message_id, pp.pursuit_id
      from producer.mail_headers o
      join producer.pursuit_parties pp on true
      left join producer.contact_emails ce
        on pp.contact_id is not null and lower(ce.email) = o.counterpart_email
     where o.direction = 'out'
       and o.message_id is not null
       and (
         (pp.contact_id is not null and ce.contact_id = pp.contact_id)
         or (pp.mailbox_email is not null and lower(pp.mailbox_email) = o.counterpart_email)
       )
  ), 回信 as (
    select distinct h.gmail_thread_id, s.pursuit_id
      from producer.mail_headers h
      join 我发出的 s
        on s.message_id = h.in_reply_to or s.message_id = any(h.refs)
      left join producer.address_verdicts v on v.email = h.counterpart_email
     where h.direction = 'in'
       and h.gmail_thread_id is not null
       -- 退信不算回信：技术上它确实引用了我那封信，但把它当成
       -- 「对方回复了」会让球权判错——卡上写着「他回你了」，
       -- 其实是信根本没送到。
       and coalesce(v.verdict, 'unsure') not in ('machine', 'bulk')
  ), w as (
    insert into producer.pursuit_threads (pursuit_id, gmail_thread_id, added_by)
    select r.pursuit_id, r.gmail_thread_id, 'fairwind' from 回信 r
    on conflict do nothing
    returning 1
  ) select count(*) into n from w;

  return jsonb_build_object('linked', n);
end $$;

-- ══ 线的往来：再加一条来路 ═════════════════════════════════════
--
-- 原来只有一条：挂在这条线名下那些人的邮件。
-- 现在加上：**登记给这条线的 thread 里的每一封**——不管发信的是谁。
-- 这样「机构里另一个人回的信」自己就落到线上了，一次都不用你动手。
create or replace view public.v_pa_pursuit_mail as
  with 班底的 as (
    select pp.pursuit_id, m.id as msg_id, coalesce(c.name, pp.mailbox_email) as who,
           (select count(distinct x.pursuit_id) from producer.pursuit_parties x
             where (pp.contact_id is not null and x.contact_id = pp.contact_id)
                or (pp.mailbox_email is not null
                    and lower(x.mailbox_email) = lower(pp.mailbox_email))) as 他挂了几条线
      from producer.pursuit_parties pp
      join producer.pursuit_messages m
        on m.gmail_message_id is not null
       and (case when pp.contact_id is not null
                 then m.contact_id = pp.contact_id
                 else lower(m.counterpart_email) = lower(pp.mailbox_email) end)
      left join producer.contacts c on c.id = pp.contact_id
  ), 串上的 as (
    -- 登记给这条线的 thread 里的每一封。回信的人可能压根不在班底里
    -- （PAM 那种：你发给 info@，某个人用自己的地址回你）——照样算这条线的。
    select t.pursuit_id, m.id as msg_id,
           coalesce(c.name, m.counterpart_email) as who
      from producer.pursuit_threads t
      join producer.mail_headers h on h.gmail_thread_id = t.gmail_thread_id
      join producer.pursuit_messages m on m.gmail_message_id = h.gmail_message_id
      left join producer.contacts c on c.id = m.contact_id
     where t.pursuit_id is not null
  ), 全部 as (
    select pursuit_id, msg_id, who, (他挂了几条线 = 1) as 独此一线, false as 串登记了 from 班底的
    union all
    select pursuit_id, msg_id, who, false, true from 串上的
  ), 合 as (
    select pursuit_id, msg_id,
           max(who) as who,
           bool_or(独此一线) as 独此一线,
           bool_or(串登记了) as 串登记了
      from 全部 group by pursuit_id, msg_id
  )
  select g.pursuit_id,
         m.id, m.role, m.kind, m.content, m.body_raw, m.meta, m.created_at,
         m.gmail_message_id, m.counterpart_email, m.contact_id,
         h.gmail_thread_id, g.who,
         -- 算这条线的：串明确登记了，或者这个人只挂着这一条线
         (g.串登记了 or g.独此一线) as on_this_line
    from 合 g
    join producer.pursuit_messages m on m.id = g.msg_id
    left join producer.mail_headers h on h.gmail_message_id = m.gmail_message_id;

revoke all on function public.pa_link_replies() from public, anon, authenticated;
grant execute on function public.pa_link_replies() to service_role;
grant select on public.v_pa_pursuit_mail to anon, authenticated, service_role;
