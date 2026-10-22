-- Producer Agent — 草稿不许从任何读面漏出来
--
-- 病：ASU 整页的左栏卷宗里，Ana Herruzo 名下写着五封信 —— 只发过一封。
--     那四条正是 0075 认出来、已经标成 kind='gmail_draft' 的草稿。
--     **库里标对了，读面没滤。**
--
-- ══ 病根：一个判据在某一天变成了错的，而我没去扫 ═══════════════
--
-- 「这是不是一封信」这件事，仓库里流通着两个判据：
--
--     kind === 'email'             —— 对的
--     gmail_message_id != null     —— **gmail_draft 出现之前**是对的
--
-- 草稿也有 gmail_message_id。0075 引入 gmail_draft 那天，后一个判据
-- 在所有用它的地方**同时变错**，而我没扫过一遍用了它的有哪些。
--
-- 于是同一件事修了三次，每次只修被指出来的那一处：
--     抽屉里的对话   → 0086
--     左栏卷宗       → 这一支
--     人卡的往来     → 这一支（34 条草稿挂在人名下，还没人看到过）
--
-- 数出来才知道有几处：v_pa_pursuit_mail 漏 15 条、v_pa_pursuit_messages
-- 漏 35 条、v_pa_pursuit_thread 漏 0 条。
--
-- ══ 药：修读面，不修组件 ═════════════════════════════════════
--
-- 组件已经忘了三次。判据收进 src/lib/letter.js 的 isLetter（带测试），
-- 读面这一层直接滤掉 —— 两道闸，任何一道单独成立都不该漏。
--
-- 而且加一个 pa_selfcheck_reads()：**每个读面数一遍漏了几条草稿**。
-- 以后加读面的时候那儿加一条，不靠谁记得。

create or replace view public.v_pa_pursuit_messages as
  select id, pursuit_id, role, kind, content, meta, created_at,
         gmail_message_id, body_raw, contact_id, counterpart_email
    from producer.pursuit_messages
   where deleted_at is null
     and kind <> 'gmail_draft';

-- v_pa_pursuit_mail：0055 的原文 + 两处 kind <> 'gmail_draft'
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
       and m.kind <> 'gmail_draft'
       and (case when pp.contact_id is not null
                 then m.contact_id = pp.contact_id
                 else lower(m.counterpart_email) = lower(pp.mailbox_email) end)
      left join producer.contacts c on c.id = pp.contact_id
  ), 串上的 as (
    select t.pursuit_id, m.id as msg_id,
           coalesce(c.name, m.counterpart_email) as who
      from producer.pursuit_threads t
      join producer.mail_headers h on h.gmail_thread_id = t.gmail_thread_id
      join producer.pursuit_messages m on m.gmail_message_id = h.gmail_message_id
       and m.kind <> 'gmail_draft'
      left join producer.contacts c on c.id = m.contact_id
     where t.pursuit_id is not null
  ), 全部 as (
    select pursuit_id, msg_id, who, (他挂了几条线 = 1) as 独此一线, false as 串登记了 from 班底的
    union all
    select pursuit_id, msg_id, who, false, true from 串上的
  ), 合 as (
    select pursuit_id, msg_id, max(who) as who,
           bool_or(独此一线) as 独此一线, bool_or(串登记了) as 串登记了
      from 全部 group by pursuit_id, msg_id
  )
  select g.pursuit_id,
         m.id, m.role, m.kind, m.content, m.body_raw, m.meta, m.created_at,
         m.gmail_message_id, m.counterpart_email, m.contact_id,
         h.gmail_thread_id, g.who,
         (g.串登记了 or g.独此一线) as on_this_line
    from 合 g
    join producer.pursuit_messages m on m.id = g.msg_id
    left join producer.mail_headers h on h.gmail_message_id = m.gmail_message_id;

grant select on public.v_pa_pursuit_messages to anon, authenticated, service_role;
grant select on public.v_pa_pursuit_mail     to anon, authenticated, service_role;

comment on view public.v_pa_pursuit_messages is
  '对话表的读面。滤掉 gmail_draft —— 草稿不是往来，任何读面都不该露它';
comment on view public.v_pa_pursuit_mail is
  '一封信算哪条线的推导（on_this_line）。滤掉 gmail_draft';

-- ══ 每个读面数一遍 ═══════════════════════════════════════════
create or replace function public.pa_selfcheck_reads()
returns table (读面 text, 漏了几条草稿 text, 通过 boolean)
language plpgsql security definer set search_path = public, producer
as $$
declare v text;
begin
  读面 := 'v_pa_pursuit_mail（左栏卷宗 / 推导）';
  select count(*)::text into v from public.v_pa_pursuit_mail where kind='gmail_draft';
  漏了几条草稿 := v; 通过 := v='0'; return next;

  读面 := 'v_pa_pursuit_messages（人卡的往来）';
  select count(*)::text into v from public.v_pa_pursuit_messages where kind='gmail_draft';
  漏了几条草稿 := v; 通过 := v='0'; return next;

  读面 := 'v_pa_pursuit_thread（一条线的对话）';
  select count(*)::text into v from public.v_pa_pursuit_thread where kind='gmail_draft';
  漏了几条草稿 := v; 通过 := v='0'; return next;

  读面 := 'v_pa_cue_facts（由头要用的事实）';
  select count(*)::text into v from public.v_pa_cue_facts f
    join producer.pursuit_messages m on m.gmail_message_id = f.last_in_id
   where m.kind = 'gmail_draft';
  漏了几条草稿 := v; 通过 := v='0'; return next;
end $$;

grant execute on function public.pa_selfcheck_reads() to service_role;

comment on function public.pa_selfcheck_reads() is
  '每个读面数一遍漏了几条草稿。加读面的时候这儿加一条 —— 这件事修过三次，每次都只修了被指出来的那一处';
