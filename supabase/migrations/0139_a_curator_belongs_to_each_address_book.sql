-- Producer Agent — 一个策展人,可以住进每本通讯录
--
-- workshop-edition(2026-08-25)。单人版的最后一块化石:
--
-- 单人时代「email 唯一标识一个联系人」是对的公理——整个库就是一本
-- 通讯录。多人之后正确的公理是「(谁的, email) 唯一」:两个学员认识
-- 同一个策展人,天经地义,谁也不该撞谁。他一眼看穿了这一点:
-- 「联系人先归他是谁的,然后这一个人只取他自己的」。
--
-- 改两层:
--   1. 五个 email 类唯一索引,前面加 owner。全部 **nulls not distinct**:
--      owner 为 null 的行(个人版 service_role 老路、auth.uid() 为空)
--      之间照旧按 email 全局唯一——老路的 upsert 语义一个字不变。
--   2. 五个拿这些索引当 on conflict 目标的函数,目标跟着改。
--      函数体逐字照抄 dev 库现行定义(已是 invoker),只动 conflict 目标。
--
-- ⚠️ 给以后的迁移立个规矩:0118 把全部 pa_* 翻成了 security invoker。
-- 此后任何重定义 pa_* 的迁移**不得写 security definer**——写了就等于
-- 在那一个函数上凿了一个绕过行级权限的洞。

-- ── 一、索引:唯一性带上 owner ────────────────────────────

drop index if exists producer.contacts_email_uniq;
create unique index contacts_email_uniq
  on producer.contacts (owner, lower(email)) nulls not distinct
  where email is not null;

drop index if exists producer.contact_emails_uniq;
create unique index contact_emails_uniq
  on producer.contact_emails (owner, lower(email)) nulls not distinct;

drop index if exists producer.org_mailboxes_uniq;
create unique index org_mailboxes_uniq
  on producer.org_mailboxes (owner, lower(email)) nulls not distinct;

drop index if exists producer.mail_accounts_addr_uniq;
create unique index mail_accounts_addr_uniq
  on producer.mail_accounts (owner, lower(address)) nulls not distinct;

-- address_verdicts 的主键本身就是 email——整张表就是单人假设。
-- 拆掉主键,换 (owner, email) 唯一。
alter table producer.address_verdicts drop constraint if exists address_verdicts_pkey;
create unique index address_verdicts_owner_email
  on producer.address_verdicts (owner, email) nulls not distinct;

-- ── 二、函数:on conflict 目标跟上 ────────────────────────

create or replace function public.pa_claim_email(p_email text, p_contact_id uuid, p_note text default null::text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare em text; n int;
begin
  em := lower(btrim(p_email));
  if em = '' then raise exception '地址不能为空'; end if;
  if exists (select 1 from producer.org_mailboxes b where lower(b.email) = em) then
    raise exception '% 是机构共享信箱，不该归给某个人', em;
  end if;
  insert into producer.contact_emails (contact_id, email, note)
  values (p_contact_id, em, p_note)
  on conflict (owner, lower(email)) do update set contact_id = excluded.contact_id;

  update producer.pursuit_messages
     set contact_id = p_contact_id
   where lower(counterpart_email) = em and contact_id is distinct from p_contact_id;
  get diagnostics n = row_count;

  update producer.contacts c
     set last_touch_at = x.d, last_touch_src = 'email'
    from (select max(created_at)::date d from producer.pursuit_messages
           where contact_id = p_contact_id and gmail_message_id is not null) x
   where c.id = p_contact_id and x.d is not null;

  return jsonb_build_object('email', em, 'moved', n);
end $function$;

create or replace function public.pa_mail_account_upsert(p_address text, p_label text default null::text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare a producer.mail_accounts;
begin
  insert into producer.mail_accounts as m (address, label)
  values (lower(btrim(p_address)), p_label)
  on conflict (owner, lower(address)) do update set label = coalesce(excluded.label, m.label)
  returning * into a;
  return to_jsonb(a);
end $function$;

create or replace function public.pa_mark_org_mailbox(p_email text, p_org text, p_label text default null::text, p_notes text default null::text)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare em text;
begin
  em := lower(btrim(p_email));
  insert into producer.org_mailboxes (org, email, label, notes)
  values (p_org, em, p_label, p_notes)
  on conflict (owner, lower(email)) do update
    set org = excluded.org, label = excluded.label, notes = excluded.notes;
  -- 机构信箱的往来不归任何人，只归机会线
  update producer.pursuit_messages set contact_id = null
   where lower(counterpart_email) = em and contact_id is not null;
end $function$;

create or replace function public.pa_verdict_upsert(p_email text, p_verdict text, p_business boolean default null::boolean, p_why text default null::text, p_name text default null::text, p_org text default null::text, p_role text default null::text, p_decided_by text default 'fairwind'::text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare em text; v producer.address_verdicts; locked boolean;
begin
  em := lower(btrim(p_email));
  if em !~ '@' then raise exception '不像个地址：%', p_email; end if;

  select (decided_by = 'you') into locked from producer.address_verdicts where email = em;
  if coalesce(locked, false) and p_decided_by <> 'you' then
    select * into v from producer.address_verdicts where email = em;
    return jsonb_build_object('written', false, 'why', '这条你翻过案，自动判定不许覆盖',
                              'verdict', to_jsonb(v));
  end if;

  insert into producer.address_verdicts as t
         (email, verdict, business, why, name, org, role, decided_by, decided_at)
  values (em, p_verdict, p_business, p_why, p_name, p_org, p_role, p_decided_by, now())
  on conflict (owner, email) do update
     set verdict = excluded.verdict, business = excluded.business, why = excluded.why,
         name = coalesce(excluded.name, t.name),
         org  = coalesce(excluded.org,  t.org),
         role = coalesce(excluded.role, t.role),
         decided_by = excluded.decided_by, decided_at = now()
  returning * into v;
  return jsonb_build_object('written', true, 'verdict', to_jsonb(v));
end $function$;

create or replace function public.pa_mail_rule_pass()
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare v_machine int := 0; v_bulk int := 0;
begin
  -- 一、地址本身就写着别回它（no-reply@ 那一类）
  with cand as (
    select distinct h.counterpart_email as email
      from producer.mail_headers h
     where h.counterpart_email ~* '^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounce|postmaster|automated)[@+.]'
        or h.counterpart_email ~* '@(bounce|em|mailer|reply)\.'
  ), w as (
    insert into producer.address_verdicts as t (email, verdict, business, why, decided_by)
    select c.email, 'machine', false, '地址本身就写着别回它', 'rule'
      from cand c
     where not exists (select 1 from producer.contact_emails e where lower(e.email) = c.email)
       and not exists (select 1 from producer.org_mailboxes b where lower(b.email) = c.email)
    on conflict (owner, email) do update
       set verdict = excluded.verdict, business = excluded.business,
           why = excluded.why, decided_by = 'rule', decided_at = now()
     where t.decided_by <> 'you'
       -- ↓ 判断没变就别写。不加这句的话，每轮都把同样的结论重写一遍，
       --   而每一次重写都会让所有开着的页面重下一次看板。
       and (t.verdict, t.business, t.why, t.decided_by)
           is distinct from (excluded.verdict, excluded.business, excluded.why, 'rule'::text)
    returning 1
  ) select count(*) into v_machine from w;

  -- 二、群发源：他发来的每一封都带群发信头，而且你一封都没回过
  with per as (
    select h.counterpart_email as email,
           count(*) filter (where h.direction = 'in')            as c_in,
           count(*) filter (where h.direction = 'in' and h.bulk) as c_bulk,
           count(*) filter (where h.direction = 'out')           as c_out
      from producer.mail_headers h
     group by h.counterpart_email
  ), cand as (
    select email from per where c_out = 0 and c_in > 0 and c_bulk = c_in
  ), w as (
    insert into producer.address_verdicts as t (email, verdict, business, why, decided_by)
    select c.email, 'bulk', false, '每封都带群发信头，你一封都没回过', 'rule'
      from cand c
     where not exists (select 1 from producer.contact_emails e where lower(e.email) = c.email)
       and not exists (select 1 from producer.org_mailboxes b where lower(b.email) = c.email)
       -- ↓ 别覆盖第一遍的判断。no-reply@ 两条都符合，先判的那句更准。
       and not exists (select 1 from producer.address_verdicts v
                        where v.email = c.email and v.verdict = 'machine')
    on conflict (owner, email) do update
       set verdict = excluded.verdict, business = excluded.business,
           why = excluded.why, decided_by = 'rule', decided_at = now()
     where t.decided_by <> 'you' and t.verdict <> 'machine'
       and (t.verdict, t.business, t.why, t.decided_by)
           is distinct from (excluded.verdict, excluded.business, excluded.why, 'rule'::text)
    returning 1
  ) select count(*) into v_bulk from w;

  return jsonb_build_object(
    'machine', v_machine,
    'bulk',    v_bulk,
    'left',    (select count(*) from (
                  select distinct h.counterpart_email e from producer.mail_headers h) x
                 where not exists (select 1 from producer.address_verdicts v where v.email = x.e)
                   and not exists (select 1 from producer.contact_emails c where lower(c.email) = x.e)
                   and not exists (select 1 from producer.org_mailboxes b where lower(b.email) = x.e)));
end $function$;
