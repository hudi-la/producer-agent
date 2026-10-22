-- Producer Agent — 一串信里的一伙人：一起收进通讯录，写清在哪个活动里合作过
-- 设计稿：docs/specs/2026-09-04-copied-people-design.md（第二节）
--
-- 他的原话（2026-09-04）：「我在一个机构做事情，这个机构除了我之外，同时还联系了
-- 一大堆艺术家。我也很愿意把他们都收进我的通讯录，并且写清楚是在哪个活动里合作过。」
--
-- 库里的样本：CalArts 驻地那一伙（Cameron 发起「Residency workshop series!」，16 人、
-- 6 个人说过话）、CultureHub XLAB 那一伙（Stacy，11 人）、ANTI-FRIEZE（Genevieve，16 人）、
-- LAAF（15 人）。共同点是**一串信里好几个人来回说话**。反例：Cevera Yoon 画廊那封
-- 121 人的活动通知 —— 只有一个人在说，那是通知，不是一伙人。
--
-- 判据（纯规则）：一串信里 ≥2 个人（不算你）说过话、≥5 个人在场、来自 ≥2 个域名、
-- 不带群发信头、其中至少 1 个还没进通讯录。
--
-- **这一步不自动收。** 0121 那种「同机构 + 有署名」是规则级证据；一伙人是跨机构的
-- 十几个陌生人，收错一伙比漏一伙麻烦，而且「在哪个活动里合作过」那句话该由他来定。
-- 所以端到「等你点头」，**一伙人一格、一个按钮**，活动名预填成信的主题，他改一改就收。

-- ══ 一、记号：这串收过了 / 这串不算 ════════════════════════════
create table if not exists producer.thread_marks (
  gmail_thread_id text primary key,
  mark            text not null,                 -- collected | skip
  note            text,                          -- 活动名（收的时候写的那句）
  at              timestamptz not null default now(),
  constraint thread_marks_mark_chk check (mark in ('collected', 'skip'))
);
comment on table producer.thread_marks is
  '一串信作为「一伙人」处理过没有。collected = 收进通讯录了（note 是活动名）；skip = 他说这串不算';

create or replace function public.pa_mark_thread(p_thread text, p_mark text, p_note text default null)
returns void
language sql security definer set search_path = public, producer as $$
  insert into producer.thread_marks as t (gmail_thread_id, mark, note)
  values (p_thread, p_mark, nullif(btrim(p_note), ''))
  on conflict (gmail_thread_id) do update
     set mark = excluded.mark, note = coalesce(excluded.note, t.note), at = now();
$$;
revoke all on function public.pa_mark_thread(text, text, text) from public;
grant execute on function public.pa_mark_thread(text, text, text) to anon, authenticated, service_role;

-- 新表要挂脉搏（0111 的规矩）。0114 的 pulse_wire 会按注册表重建全部触发器，重跑安全。
select producer.pulse_wire();

-- ══ 二、一伙人：还没处理过的那些信串 ═══════════════════════════
--
-- 浏览器和脑子读同一个口。脑子只多做一件事：need_names 里那几封去 Gmail 拿一次
-- 署名写回来（老信的 To/Cc 没存署名，0121 加的那列）。
create or replace function public.pa_group_threads(p_min_people int default 5)
returns jsonb
language sql security definer set search_path = public, producer as $$
  with mine as (
    -- 登记过的信箱。Gmail 把本地部分里的点当没有（hudicreates@ = hudi.creates@），
    -- 所以 gmail 地址两种写法都算我 —— 不然他自己会以「陌生人 Di Hu」的样子混在一伙人里
    select lower(a.address) as a from producer.mail_accounts a
    union
    select replace(split_part(lower(a.address), '@', 1), '.', '') || '@gmail.com'
      from producer.mail_accounts a
     where split_part(lower(a.address), '@', 2) in ('gmail.com', 'googlemail.com')
  ), t as (
    select h.gmail_thread_id,
           min(h.sent_at) as first_at, max(h.sent_at) as last_at, count(*) as n_mails,
           (array_agg(h.subject order by h.sent_at) filter (where h.subject is not null))[1] as subject,
           (array_agg(h.from_email order by h.sent_at))[1] as starter_email,
           (array_agg(h.from_name  order by h.sent_at))[1] as starter_name,
           count(distinct h.from_email) filter (where h.from_email not in (select a from mine)) as n_senders,
           bool_or(h.bulk) as any_bulk,
           -- 没存过署名的信（老信）。给脑子去补；补完 names 至少是 {}，就不在这儿了。
           -- 一串里的都给，一次补完 —— 只给三封的话要好几轮才收敛
           array_agg(h.gmail_message_id order by h.sent_at) filter (where h.names is null) as unnamed_ids
      from producer.mail_headers h
     where not h.is_draft
     group by h.gmail_thread_id
  ), mem as (
    select h.gmail_thread_id, a.addr as email,
           max(h.from_name) filter (where h.from_email = a.addr)   as wrote_name,
           max(nullif(h.names ->> a.addr, ''))                      as cc_name,
           bool_or(h.from_email = a.addr)                           as wrote
      from producer.mail_headers h
      cross join lateral unnest(h.to_emails || h.cc_emails || array[h.from_email]) as a(addr)
     where not h.is_draft
     group by h.gmail_thread_id, a.addr
  ), m2 as (
    select m.gmail_thread_id, m.email,
           -- 已经认识的用名片上的名字；其余用他写信时的署名，再退到抄送栏里的署名
           coalesce(c.name, m.wrote_name, m.cc_name) as name, m.wrote,
           (m.email in (select a from mine)
            or (split_part(m.email, '@', 2) in ('gmail.com', 'googlemail.com')
                and replace(split_part(m.email, '@', 1), '.', '') || '@gmail.com' in (select a from mine))) as is_me,
           ce.contact_id,
           (ce.contact_id is not null
            or exists (select 1 from producer.org_mailboxes b where lower(b.email) = m.email)) as known,
           -- info@ 这种一看就是个组，不该建成人；单独留在下面让他认
           (split_part(m.email, '@', 1) ~* '^(info|office|programs?|admin|hello|contact|contacts|mail|team|staff|events?|workshops?|residency|residencies|education|press|marketing|support|sales|hr|jobs|careers|general|inquiry|inquiries|enquiry|enquiries|reception|frontdesk|gallery|studio|shop|store|bookings?|registrar|tickets?|newsletter|news|media|outreach|community|volunteers?|membership|development|grants?|applications?|apply|submissions?|submit|curatorial|exhibitions?|library|archives?|visitorcenter|welcome|questions|help|services?)$') as generic,
           v.verdict, v.org,
           (coalesce(v.decided_by, '') = 'you'
            and (coalesce(v.verdict, '') in ('machine', 'bulk') or not coalesce(v.business, true))) as rejected
      from mem m
      left join producer.contact_emails ce on lower(ce.email) = m.email
      left join producer.contacts c on c.id = ce.contact_id
      left join producer.address_verdicts v on v.email = m.email
     where m.email !~* '^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounces?|postmaster|automated)[-+.@]'
  ), agg as (
    select gmail_thread_id,
           count(*) filter (where not is_me)                                          as n_people,
           count(distinct split_part(email, '@', 2)) filter (where not is_me)         as n_dom,
           count(*) filter (where not is_me and not known and not rejected and not generic) as n_unknown,
           jsonb_agg(jsonb_build_object(
             'email', email, 'name', name, 'wrote', wrote, 'known', known,
             'contact_id', contact_id, 'org', org, 'verdict', verdict,
             'generic', generic, 'rejected', rejected)
             order by known desc, wrote desc, name nulls last, email)
             filter (where not is_me)                                                 as members
      from m2
     group by gmail_thread_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'thread',     t.gmail_thread_id,
           'subject',    t.subject,
           'first_at',   t.first_at::date,
           'last_at',    t.last_at::date,
           'n_mails',    t.n_mails,
           'n_senders',  t.n_senders,
           'n_people',   a.n_people,
           'n_unknown',  a.n_unknown,
           'starter',    jsonb_build_object(
                           'email', t.starter_email,
                           'is_me', t.starter_email in (select a from mine),
                           'name',  coalesce(
                                      (select c.name from producer.contact_emails ce
                                         join producer.contacts c on c.id = ce.contact_id
                                        where lower(ce.email) = t.starter_email limit 1),
                                      t.starter_name)),
           'members',    a.members,
           'need_names', coalesce(to_jsonb(t.unnamed_ids), '[]'::jsonb),
           'on_line',    (select p.title from producer.pursuit_threads pt
                            join producer.pursuits p on p.id = pt.pursuit_id
                           where pt.gmail_thread_id = t.gmail_thread_id limit 1)
         ) order by t.last_at desc), '[]'::jsonb)
    from t
    join agg a using (gmail_thread_id)
   where t.n_senders >= 2
     and a.n_people >= greatest(p_min_people, 3)
     and a.n_dom >= 2
     and not t.any_bulk
     and a.n_unknown >= 1
     and not exists (select 1 from producer.thread_marks k where k.gmail_thread_id = t.gmail_thread_id);
$$;
revoke all on function public.pa_group_threads(int) from public;
grant execute on function public.pa_group_threads(int) to anon, authenticated, service_role;
