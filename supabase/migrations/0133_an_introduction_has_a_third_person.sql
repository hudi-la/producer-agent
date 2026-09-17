-- Producer Agent — 引荐信里的第三个人：没有机会线也得有人管
--
-- 真事（2026-09-11 查出来的）：Stacy 9/8 发了一封 "Introduction: HuDi and David"，
-- 收件人是 blairdav@usc.edu 和你。三天后问系统「David 收进通讯录了吗」——
-- contacts、contact_emails、address_verdicts、org_mailboxes、pursuit_parties
-- 五张表里一条都没有。他连「等你点头」那一栏都没排上队。
--
-- 为什么漏。两条通道都够不着他：
--   · 判地址（pa_address_candidates）按 counterpart_email 分组，而**一封信只认
--     一个「对面」**。这封是 Stacy 发来的，对面就记成 Stacy；David 在收件人栏里，
--     系统里根本没有「这封信还有第二个人」这个概念。
--   · 抄送捡人（0121）确实翻 To/Cc 捡人，但它的候选只从**机会线**的信串里来
--     （lined = pursuit_threads join pursuits）。Stacy 是一张纯人脉名片，名下
--     没有机会线 —— 这条规则从头到尾没扫到她这儿。
--
-- 0121 开头那句话现在得往前推一格：「整条管线只看 counterpart_email，一个只
-- 出现在抄送栏里的人永远轮不到被判」——**在没有机会线的人脉往来里，这句话
-- 还原封不动地成立。**
--
-- ══ 这一刀 ═════════════════════════════════════════════════════
--
-- 候选多一路：一封信**已经归到某张名片名下**（counterpart_email 是他的地址），
-- To/Cc 里还有别人 → 那个人就是候选。不要求那条线存在，因为人脉往来本来就没有线。
--
-- 三道闸，缺一道就是噪音：
--   ① 只从 Fairwind 开工那天（2026-08-03，跟 judge.js 的 EPOCH 同一个日子）起算。
--      不加这道：2025 年 LMU 入职那一串 HR 抄送、CalArts 的群发，一口气翻出 68 个
--      地址端到他面前。**那是要他对账，不是帮他记人。**
--   ② 这封信上除我以外的收件人 ≤ 3 个。再多就不是引荐、是通知或者一伙人 ——
--      「一伙人」有 0122 专管，一人一格地端出来只会把面板冲垮。
--   ③ 机会线上的信串归 0121 原来那两路管，这儿不重复捡。
--
-- 加上这三道，全库回头扫一遍只翻出一个人：David Blair。那正是该翻出来的那一个。
--
-- ══ 这一路只端不收 ═════════════════════════════════════════════
--
-- 没有线可挂，也就没有「同机构就是这条线的人」那种规则级证据。所以这一路
-- **永远走「等你点头」**，不自动建名片 —— 挡在 brain/mail/copied.js 的 decide()
-- 里（pursuit_id 为空 = 没有线，不许 adopt）。加人还是只在「新联系人」面板。

create or replace function public.pa_copied_strangers()
returns table (
  email            text,
  kind             text,          -- cc | to | reply
  name             text,          -- 署名；没有就 null
  name_checked     boolean,       -- 署名查过了没（false = 脑子该去 Gmail 拿一次）
  same_org         boolean,       -- 跟发信人或这条线上的人同一个域名
  via_email        text,          -- 谁带进来的（reply 时为空）
  via_name         text,
  via_contact_id   uuid,
  via_direction    text,          -- in = 对方抄送的 | out = 你抄送的
  pursuit_id       uuid,          -- 为空 = 人脉往来，没有线（只端不收）
  pursuit_title    text,          -- 没有线时是那张名片的名字
  pursuit_org      text,
  org_guess        text,          -- 该写哪个机构名
  gmail_message_id text,
  sent_at          timestamptz,
  n                bigint,        -- 带着他的信有几封
  verdict          text,          -- 已有的判定（多半没有）
  business         boolean,
  decided_by       text
)
language sql security definer set search_path = public, producer as $$
  with mine as (
    select lower(a.address) as a from producer.mail_accounts a
  ), known as (
    select lower(e.email) as e from producer.contact_emails e
    union select lower(b.email) from producer.org_mailboxes b
  ), lined as (
    select t.gmail_thread_id, t.pursuit_id, p.title, p.org
      from producer.pursuit_threads t
      join producer.pursuits p on p.id = t.pursuit_id
     where t.pursuit_id is not null
  ), line_dom as (
    select pp.pursuit_id, split_part(lower(coalesce(ce.email, pp.mailbox_email)), '@', 2) as dom
      from producer.pursuit_parties pp
      left join producer.contact_emails ce on pp.contact_id is not null and ce.contact_id = pp.contact_id
     where coalesce(ce.email, pp.mailbox_email) is not null
       and split_part(lower(coalesce(ce.email, pp.mailbox_email)), '@', 2) <> all (public.pa_public_mail_domains())
  ), hits as (
    select x.addr as email, x.kind,
           nullif(h.names ->> x.addr, '') as name,
           coalesce(h.names ? x.addr, false) as name_checked,
           h.counterpart_email as via_email, h.direction as via_direction,
           case when h.direction = 'in' then h.from_name
                else nullif(h.names ->> h.counterpart_email, '') end as via_name,
           l.pursuit_id, l.title as pursuit_title, l.org as pursuit_org,
           h.gmail_message_id, h.sent_at
      from producer.mail_headers h
      join lined l on l.gmail_thread_id = h.gmail_thread_id
      cross join lateral (
        select unnest(h.cc_emails) as addr, 'cc' as kind
        union all
        select unnest(h.to_emails), 'to'
      ) x
     where not h.is_draft and not h.bulk
       and x.addr not in (select a from mine)
       and x.addr <> h.counterpart_email
    union all
    select h.counterpart_email, 'reply', h.from_name, true,
           null, 'in', null,
           l.pursuit_id, l.title, l.org, h.gmail_message_id, h.sent_at
      from producer.mail_headers h
      join lined l on l.gmail_thread_id = h.gmail_thread_id
     where h.direction = 'in' and not h.is_draft and not h.bulk
       and exists (select 1 from line_dom d
                    where d.pursuit_id = l.pursuit_id
                      and d.dom = split_part(h.counterpart_email, '@', 2))
    union all
    -- ③ 人脉往来里同席的陌生人（0126）。没有线，所以 pursuit_id 为空，
    --    pursuit_title 放那张名片的名字 —— 理由那句话要说清是「跟谁的往来里」。
    select x.addr, x.kind,
           nullif(h.names ->> x.addr, ''),
           coalesce(h.names ? x.addr, false),
           h.counterpart_email, h.direction,
           case when h.direction = 'in' then h.from_name
                else nullif(h.names ->> h.counterpart_email, '') end,
           null::uuid, c.name, c.org, h.gmail_message_id, h.sent_at
      from producer.mail_headers h
      join producer.contact_emails ce on lower(ce.email) = h.counterpart_email
      join producer.contacts c on c.id = ce.contact_id
      cross join lateral (
        select unnest(h.cc_emails) as addr, 'cc' as kind
        union all
        select unnest(h.to_emails), 'to'
      ) x
     where not h.is_draft and not h.bulk
       and h.sent_at >= '2026-08-03'                       -- 闸①：Fairwind 开工那天
       and x.addr not in (select a from mine)
       and x.addr <> h.counterpart_email
       and not exists (select 1 from lined l where l.gmail_thread_id = h.gmail_thread_id)  -- 闸③
       and (select count(*) from unnest(h.to_emails || h.cc_emails) a
             where a not in (select a from mine)) <= 3     -- 闸②：再多就不是引荐
  ), picked as (
    select distinct on (email, pursuit_id) *,
           count(*) over (partition by email, pursuit_id) as n
      from hits
     order by email, pursuit_id, sent_at
  )
  select p.email, p.kind, p.name, p.name_checked,
         (split_part(p.email, '@', 2) <> all (public.pa_public_mail_domains())
          and (split_part(p.email, '@', 2) = split_part(coalesce(p.via_email, ''), '@', 2)
               or exists (select 1 from line_dom d
                           where d.pursuit_id = p.pursuit_id
                             and d.dom = split_part(p.email, '@', 2)))) as same_org,
         p.via_email,
         coalesce((select c.name from producer.contact_emails ce
                     join producer.contacts c on c.id = ce.contact_id
                    where lower(ce.email) = p.via_email limit 1), p.via_name) as via_name,
         (select ce.contact_id from producer.contact_emails ce
           where lower(ce.email) = p.via_email limit 1) as via_contact_id,
         p.via_direction,
         p.pursuit_id, p.pursuit_title, p.pursuit_org,
         coalesce(
           (select c.org from producer.contact_emails ce
              join producer.contacts c on c.id = ce.contact_id
             where lower(ce.email) = p.via_email and c.org is not null limit 1),
           (select v.org from producer.address_verdicts v
             where v.email = p.via_email and v.org is not null),
           (select c.org from producer.pursuit_parties pp
              join producer.contacts c on c.id = pp.contact_id
              join producer.contact_emails ce on ce.contact_id = c.id
             where pp.pursuit_id = p.pursuit_id and c.org is not null
               and split_part(lower(ce.email), '@', 2) = split_part(p.email, '@', 2) limit 1),
           (select b.org from producer.org_mailboxes b
             where split_part(lower(b.email), '@', 2) = split_part(p.email, '@', 2) limit 1),
           p.pursuit_org) as org_guess,
         p.gmail_message_id, p.sent_at, p.n,
         v.verdict, v.business, v.decided_by
    from picked p
    left join producer.address_verdicts v on v.email = p.email
   where p.email not in (select e from known)
     and p.email !~* '^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounces?|postmaster|automated)[-+.@]'
     and not (coalesce(v.decided_by, '') = 'you'
              and (coalesce(v.verdict, '') in ('machine', 'bulk') or not coalesce(v.business, true)))
   order by p.sent_at;
$$;

revoke all on function public.pa_copied_strangers() from public, anon, authenticated;
grant execute on function public.pa_copied_strangers() to service_role;
