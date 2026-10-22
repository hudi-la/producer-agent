-- Producer Agent — 被抄送的人、同机构回信的人，自己进通讯录和机会卡
-- 设计稿：docs/specs/2026-09-04-copied-people-design.md
--
-- 真事（2026-09-04 查库）：
--   · Brooke（Arboretum）8/11 回信时抄送了 rachel.masters@，你之后回的四封
--     都带着她 —— 系统里任何一张表都没有她。
--   · Lorna（Printing Museum）8/16、8/26 回信时抄送了 meighan@；9/4 Meighan
--     自己回了信 —— 她的休假自动回复早被规则判成「群发」，这封真回信卡在
--     账本里，卡片上看不见。
--
-- 为什么漏：To/Cc 从第一天起就存着，但整条管线只看 counterpart_email。
-- 一个只出现在抄送栏里的人，永远轮不到被判。
--
-- 这一刀是一条**规则级**判断，不过模型：
--   一封在某条线的信串里的信，To/Cc 里出现的、或从中回信的地址，
--   如果跟这条线上已有的人同一个机构（域名相同）→ 他就是这条线的人。
-- 满足的自动：建名片 → 认领地址 → 挂上线 → 他自己的信搬进对话表。
-- 不同机构的、看着像共享信箱的、没署名的 → 进「新联系人」面板，理由写清是谁
-- 在哪条线抄送的。人和信箱怎么分，在 brain/mail/copied.js 里（它有署名）。
--
-- 来源三处都写：名片 notes（界面「关系记忆」）、名片 meta.source（结构化）、
-- 线上 pursuit_parties.note（卡片「相关的人」那一行小字）。

-- ══ 一、署名存下来 ═════════════════════════════════════════════
alter table producer.mail_headers add column if not exists names jsonb;
comment on column producer.mail_headers.names is
  '地址 → 署名（From/To/Cc 里写着的）。抄送栏里的人靠它认成人。值是 "" 表示看过了、没署名 —— 别再去 Gmail 拿';

create or replace function public.pa_mail_headers_upsert(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare n_ins int;
begin
  with incoming as (
    select
      r->>'gmail_message_id'                                    as gmail_message_id,
      (r->>'account_id')::uuid                                  as account_id,
      r->>'gmail_thread_id'                                     as gmail_thread_id,
      lower(btrim(r->>'from_email'))                            as from_email,
      nullif(btrim(coalesce(r->>'from_name', '')), '')          as from_name,
      coalesce(array(select lower(btrim(x #>> '{}')) from jsonb_array_elements(coalesce(r->'to_emails', '[]'::jsonb)) x), '{}') as to_emails,
      coalesce(array(select lower(btrim(x #>> '{}')) from jsonb_array_elements(coalesce(r->'cc_emails', '[]'::jsonb)) x), '{}') as cc_emails,
      nullif(btrim(coalesce(r->>'subject', '')), '')            as subject,
      (r->>'sent_at')::timestamptz                              as sent_at,
      lower(btrim(r->>'counterpart_email'))                     as counterpart_email,
      r->>'direction'                                           as direction,
      coalesce((r->>'bulk')::boolean, false)                    as bulk,
      nullif(btrim(coalesce(r->>'message_id', '')), '')         as message_id,
      nullif(btrim(coalesce(r->>'in_reply_to', '')), '')        as in_reply_to,
      coalesce(array(select btrim(x #>> '{}') from jsonb_array_elements(coalesce(r->'refs', '[]'::jsonb)) x), '{}') as refs,
      case when jsonb_typeof(r->'labels') = 'array'
           then array(select x #>> '{}' from jsonb_array_elements(r->'labels') x) end as labels,
      -- 新加的只有这一行（0121）
      case when jsonb_typeof(r->'names') = 'object' then r->'names' end as names
    from jsonb_array_elements(p_rows) r
  ), ok as (
    select * from incoming
     where gmail_message_id is not null and gmail_message_id <> ''
       and counterpart_email like '%@%'
       and direction in ('in', 'out')
       and sent_at is not null
  ), 记标签 as (
    insert into producer.mail_label_audit (gmail_message_id, labels, gone)
    select gmail_message_id, labels, false from ok where labels is not null
    on conflict (gmail_message_id) do update
       set labels = excluded.labels, gone = false, checked_at = now()
    returning 1
  ), ins as (
    insert into producer.mail_headers (
      gmail_message_id, account_id, gmail_thread_id, from_email, from_name,
      to_emails, cc_emails, subject, sent_at, counterpart_email, direction, bulk,
      message_id, in_reply_to, refs, names)
    select gmail_message_id, account_id, gmail_thread_id, from_email, from_name,
           to_emails, cc_emails, subject, sent_at, counterpart_email, direction, bulk,
           message_id, in_reply_to, refs, names
      from ok
    on conflict (gmail_message_id) do update
       set message_id  = coalesce(excluded.message_id,  producer.mail_headers.message_id),
           in_reply_to = coalesce(excluded.in_reply_to, producer.mail_headers.in_reply_to),
           refs        = case when coalesce(array_length(excluded.refs, 1), 0) > 0
                              then excluded.refs else producer.mail_headers.refs end,
           -- 老信补核标签时顺手把署名也补上；已有的不覆盖
           names       = coalesce(producer.mail_headers.names, excluded.names)
    returning (xmax = 0) as fresh
  )
  select count(*) filter (where fresh) into n_ins from ins;

  return jsonb_build_object(
    'given',   jsonb_array_length(p_rows),
    'written', n_ins,
    'skipped', jsonb_array_length(p_rows) - n_ins);
end $$;

revoke all on function public.pa_mail_headers_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.pa_mail_headers_upsert(jsonb) to service_role;

-- 老信的署名：脑子去 Gmail 拿一次信头，写回来。下轮就不用再去。
-- p_rows: [{gmail_message_id, names: {地址: 署名 | ""}}]
create or replace function public.pa_mail_names_fill(p_rows jsonb)
returns int
language sql security definer set search_path = public, producer as $$
  with w as (
    update producer.mail_headers h
       set names = coalesce(h.names, '{}'::jsonb) || (r->'names')
      from jsonb_array_elements(p_rows) r
     where h.gmail_message_id = r->>'gmail_message_id'
       and jsonb_typeof(r->'names') = 'object'
    returning 1
  ) select count(*)::int from w;
$$;
revoke all on function public.pa_mail_names_fill(jsonb) from public, anon, authenticated;
grant execute on function public.pa_mail_names_fill(jsonb) to service_role;

-- 公共邮箱的域名。两个 gmail.com 地址不是同事。
create or replace function public.pa_public_mail_domains()
returns text[] language sql immutable as $$
  select array['gmail.com','googlemail.com','yahoo.com','hotmail.com','outlook.com','live.com',
               'msn.com','icloud.com','me.com','mac.com','aol.com','protonmail.com','proton.me',
               'pm.me','qq.com','163.com','126.com','foxmail.com','yandex.com','gmx.com','mail.com']
$$;

-- ══ 二、候选：线上的信里，还不认识的那些地址 ═════════════════
--
-- 两种形状，一个口出：
--   cc / to  一封在线上的信，To/Cc 里不是我、不是发信人、还没进通讯录的地址
--   reply    在线上的串里，从一个还没进通讯录的地址回信的人 —— 只要同机构的
--            （不同机构的回信人本来就走「等你点头」，不归这儿管）
--
-- 每个（地址 × 线）只出**最早那一封**：来路要说「第一次是谁带进来的」。
-- 不看时间窗：Rachel 是 8/11 被带进来的，今天才补上，照样要补。
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
  pursuit_id       uuid,
  pursuit_title    text,
  pursuit_org      text,
  org_guess        text,          -- 该写哪个机构名
  gmail_message_id text,
  sent_at          timestamptz,
  n                bigint,        -- 在这条线上带着他的信有几封
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
    -- 这条线上已有的人和信箱，各自的域名。
    -- gmail.com 这种公共邮箱的域名不算「同一个机构」：线上有个人用 gmail，
    -- 不等于所有用 gmail 的都是他同事。
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
     -- 地址本身就写着「别回我」的不算人
     and p.email !~* '^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounces?|postmaster|automated)[-+.@]'
     -- 你翻过案说「不是人 / 不相干」的，谁也不许再端上来。
     -- v 多半是空的（没判过）—— coalesce 不能少，null and … 会把整行吃掉
     and not (coalesce(v.decided_by, '') = 'you'
              and (coalesce(v.verdict, '') in ('machine', 'bulk') or not coalesce(v.business, true)))
   order by p.sent_at;
$$;
revoke all on function public.pa_copied_strangers() from public, anon, authenticated;
grant execute on function public.pa_copied_strangers() to service_role;

-- ══ 三、收一个人：建名片 → 认领地址 → 挂上线 ═══════════════════
--
-- 一个口做完，来路写在三处。已经有名片的（地址认过、或名片上就是这个
-- 地址）不重建，只补挂线。**没署名不建人** —— 不编名字。
create or replace function public.pa_adopt_copied(
  p_email       text,
  p_name        text,
  p_org         text,
  p_pursuit_id  uuid,
  p_note        text,               -- 写进名片 notes / 地址 note / 判定 why
  p_party_note  text,               -- 写进线上那一行
  p_meta        jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, producer as $$
declare em text; cid uuid; created boolean := false; claimed jsonb; lines text[];
begin
  em := lower(btrim(p_email));
  if em !~ '@' then raise exception '不像个地址：%', p_email; end if;
  if exists (select 1 from producer.org_mailboxes b where lower(b.email) = em) then
    raise exception '% 是机构共享信箱，不该建成人', em;
  end if;

  select ce.contact_id into cid from producer.contact_emails ce where lower(ce.email) = em limit 1;
  if cid is null then
    select c.id into cid from producer.contacts c where lower(c.email) = em limit 1;
  end if;
  if cid is null then
    if coalesce(btrim(p_name), '') = '' then raise exception '没有署名不建人：%', em; end if;
    insert into producer.contacts (name, email, org, notes, meta)
    values (btrim(p_name), em, p_org, p_note,
            jsonb_build_object('source', coalesce(p_meta, '{}'::jsonb)))
    returning id into cid;
    created := true;
    if coalesce(btrim(p_org), '') <> '' then
      insert into producer.contact_orgs (contact_id, org) values (cid, btrim(p_org))
      on conflict do nothing;
    end if;
  end if;

  -- 认领：他名下已有的往来当场归位（0038 的语义）
  claimed := public.pa_claim_email(em, cid, p_note);
  -- 判定跟着改：休假自动回复害他被判成「群发」那种，在这儿翻回来。
  -- 你翻过案的 pa_verdict_upsert 自己会拒绝。
  perform public.pa_verdict_upsert(em, 'person', true, p_note, p_name, p_org, null, 'rule');
  -- 挂上这条线，来路写在行上
  perform public.pa_attach_party(p_pursuit_id, cid, null, p_party_note, 'rule');
  -- 他自己的信要是早就落在别的线上，也一并挂上（0106）
  lines := public.pa_attach_address_lines(em, cid, null);

  return jsonb_build_object(
    'contact_id', cid, 'created', created,
    'moved', claimed -> 'moved', 'other_lines', to_jsonb(lines));
end $$;
revoke all on function public.pa_adopt_copied(text, text, text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.pa_adopt_copied(text, text, text, uuid, text, text, jsonb) to service_role;
