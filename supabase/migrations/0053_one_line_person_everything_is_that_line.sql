-- 「这封信算不算这条线的」判得太窄了。
--
-- 0052 的判据只有一条：这封信的 thread 已经登记给这条线了吗。可绝大多数
-- thread 一条线都没登记过（65 条线里只有 3 条有 thread），于是刚把 Brooke
-- 挂到 Arboretum 那条线上，她那三封信全被判成「别的往来」折起来了——
-- 而那三封**就是**这条线的事。
--
-- 补一条：**这个人只挂在这一条线上的时候，他的信全算这条线的。**
--
-- 道理很简单：要分，是因为一个人牵扯好几条线才需要分。只挂着一条线的人，
-- 他跟你说的每一句话都是那条线的事，没有第二个去处。
-- 只有他同时挂在两条以上线上时，才回到「按 thread 判」——那时候
-- 已登记的 thread 说了算，没登记的两边都折起来等你指认。
create or replace view public.v_pa_pursuit_mail as
  select distinct
         pp.pursuit_id,
         m.id, m.role, m.kind, m.content, m.body_raw, m.meta, m.created_at,
         m.gmail_message_id, m.counterpart_email, m.contact_id,
         h.gmail_thread_id,
         coalesce(c.name, pp.mailbox_email) as who,
         (
           -- ① 这串信明确登记给了这条线
           t.pursuit_id is not null
           -- ② 或者：这个人只挂在这一条线上，那他的信没有第二个去处
           or (
             (select count(distinct x.pursuit_id) from producer.pursuit_parties x
               where (pp.contact_id is not null and x.contact_id = pp.contact_id)
                  or (pp.mailbox_email is not null
                      and lower(x.mailbox_email) = lower(pp.mailbox_email))) = 1
             -- 但别抢：这串信要是已经登记给**别的**线了，就还是别的线的
             and not exists (select 1 from producer.pursuit_threads t2
                              where t2.gmail_thread_id = h.gmail_thread_id
                                and t2.pursuit_id is not null)
           )
         ) as on_this_line
    from producer.pursuit_parties pp
    join producer.pursuit_messages m
      on m.gmail_message_id is not null
     and (case when pp.contact_id is not null
               then m.contact_id = pp.contact_id
               else lower(m.counterpart_email) = lower(pp.mailbox_email) end)
    left join producer.contacts c on c.id = pp.contact_id
    left join producer.mail_headers h on h.gmail_message_id = m.gmail_message_id
    left join producer.pursuit_threads t
      on t.pursuit_id = pp.pursuit_id and t.gmail_thread_id = h.gmail_thread_id;

grant select on public.v_pa_pursuit_mail to anon, authenticated, service_role;
