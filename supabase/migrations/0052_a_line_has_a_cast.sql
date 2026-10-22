-- 一条线牵扯的是**一伙人**，不是一个人。
--
-- ══ 这一刀在修什么 ═══════════════════════════════════════════════
--
-- Brooke Applegate 今天回了信。人际管理那边好好的（「8/11 他回你了，还没回」），
-- 但「合作开课 · LA County Arboretum」那条线上是 0 封。
--
-- 因为 pursuit_messages 有两个主人栏：pursuit_id 和 contact_id。pa_add_mail
-- 按地址自动填 contact_id，而 pursuit_id 要调用方另外传——认领走的是「人」
-- 那条路，传的是 null。于是 546 封信只挂在人身上，一条线都没挂上。
--
-- 而 pursuits.contact_id 是**单个**的，这是根上的不够用：Brooke 那封信还
-- 抄送了 Rachel；SFCB 那条线上有 Sarah 和 workshops@ 两个。
--
-- ══ 为什么是推导，不是盖章 ═══════════════════════════════════════
--
-- 本来可以给每封信补盖一个 pursuit_id。但那是**一次性动作**——以后每来
-- 一封新信都得再判一次「这封属于哪条线」，判漏一次那封信就又不见了。
--
-- 改成推导：**线的往来 = 它自己的对话 + 挂在它名下那些人的邮件**。
-- 你把一个人挂到一条线上，他以后所有的信自动出现在那条线上，
-- 不需要任何额外动作。自动化是免费的，因为根本没有「同步」这一步。

-- ══ 一、一条线的班底 ═══════════════════════════════════════════
--
-- 人和机构共享信箱两种都要装得下：SFCB 那条线上，Sarah 是人、
-- workshops@sfcb.org 是机构信箱，两个都是这条线的班底。
create table if not exists producer.pursuit_parties (
  id            uuid primary key default gen_random_uuid(),
  pursuit_id    uuid not null references producer.pursuits(id) on delete cascade,
  contact_id    uuid references producer.contacts(id) on delete cascade,
  mailbox_email text,                                   -- 机构共享信箱（不是人）
  note          text,                                   -- 他在这条线里是什么角色
  added_by      text not null default 'you',            -- you | fairwind
  created_at    timestamptz not null default now(),
  -- 要么是个人，要么是个信箱，不能都是也不能都不是
  constraint pp_one_kind_chk check (
    (contact_id is not null and mailbox_email is null) or
    (contact_id is null and mailbox_email is not null))
);
create unique index if not exists pp_contact_uniq
  on producer.pursuit_parties (pursuit_id, contact_id) where contact_id is not null;
create unique index if not exists pp_mailbox_uniq
  on producer.pursuit_parties (pursuit_id, lower(mailbox_email)) where mailbox_email is not null;
create index if not exists pp_by_contact on producer.pursuit_parties (contact_id) where contact_id is not null;

comment on table producer.pursuit_parties is
  '一条线的班底：人 + 机构共享信箱。线的往来由它推导出来，不靠给每封信盖 pursuit_id';

-- 已经挂着单个联系人的那几条线，先搬进来，别让老数据掉在外面
insert into producer.pursuit_parties (pursuit_id, contact_id, note, added_by)
select p.id, p.contact_id, '从 pursuits.contact_id 迁来的', 'you'
  from producer.pursuits p where p.contact_id is not null
on conflict do nothing;

-- ══ 二、挂上 / 摘掉 ════════════════════════════════════════════
create or replace function public.pa_attach_party(
  p_pursuit_id uuid,
  p_contact_id uuid default null,
  p_mailbox    text default null,
  p_note       text default null,
  p_by         text default 'you'
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare r producer.pursuit_parties;
begin
  if (p_contact_id is null) = (coalesce(btrim(p_mailbox), '') = '') then
    raise exception '要么给一个人，要么给一个机构信箱，不能都给也不能都不给';
  end if;
  insert into producer.pursuit_parties as t (pursuit_id, contact_id, mailbox_email, note, added_by)
  values (p_pursuit_id, p_contact_id, nullif(lower(btrim(p_mailbox)), ''), p_note, p_by)
  on conflict do nothing
  returning * into r;
  if r.id is null then
    select * into r from producer.pursuit_parties
     where pursuit_id = p_pursuit_id
       and (contact_id is not distinct from p_contact_id)
       and (lower(mailbox_email) is not distinct from nullif(lower(btrim(p_mailbox)), ''));
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.pa_detach_party(p_id uuid)
returns void
language sql security definer set search_path to 'public'
as $$ delete from producer.pursuit_parties where id = p_id; $$;

-- ══ 三、一条线上都有谁 ═════════════════════════════════════════
create or replace view public.v_pa_pursuit_parties as
  select pp.id, pp.pursuit_id, pp.contact_id, pp.mailbox_email, pp.note, pp.added_by,
         coalesce(c.name, b.org, pp.mailbox_email) as name,
         coalesce(c.org, b.org)                    as org,
         c.role,
         (pp.mailbox_email is not null)            as is_mailbox,
         (select count(*) from producer.pursuit_messages m
           where m.gmail_message_id is not null
             and (case when pp.contact_id is not null
                       then m.contact_id = pp.contact_id
                       else lower(m.counterpart_email) = lower(pp.mailbox_email) end)) as mails,
         (select max(m.created_at)::date from producer.pursuit_messages m
           where m.gmail_message_id is not null
             and (case when pp.contact_id is not null
                       then m.contact_id = pp.contact_id
                       else lower(m.counterpart_email) = lower(pp.mailbox_email) end)) as last_at
    from producer.pursuit_parties pp
    left join producer.contacts c     on c.id = pp.contact_id
    left join producer.org_mailboxes b on lower(b.email) = lower(pp.mailbox_email);

-- ══ 四、一条线的往来（推导出来的）══════════════════════════════
--
-- on_this_line：这封信所在的 thread 已经登记给这条线了吗。
--   true  —— 就是这条线的事，默认展开
--   false —— 跟这个人的**别的**往来，折起来放一行「还有 N 封」
--
-- 两种都给，一封都不藏：不丢东西，也不吵。
create or replace view public.v_pa_pursuit_mail as
  select distinct
         pp.pursuit_id,
         m.id, m.role, m.kind, m.content, m.body_raw, m.meta, m.created_at,
         m.gmail_message_id, m.counterpart_email, m.contact_id,
         h.gmail_thread_id,
         coalesce(c.name, pp.mailbox_email) as who,
         (t.pursuit_id is not null)         as on_this_line
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

-- ══ 五、锁面 ═══════════════════════════════════════════════════
revoke all on function public.pa_attach_party(uuid, uuid, text, text, text) from public;
revoke all on function public.pa_detach_party(uuid) from public;
grant execute on function public.pa_attach_party(uuid, uuid, text, text, text)
  to anon, authenticated, service_role;
grant execute on function public.pa_detach_party(uuid) to anon, authenticated, service_role;
grant select on public.v_pa_pursuit_parties to anon, authenticated, service_role;
grant select on public.v_pa_pursuit_mail    to anon, authenticated, service_role;
