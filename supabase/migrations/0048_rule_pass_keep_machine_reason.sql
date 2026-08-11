-- 第二遍（群发源）会把第一遍判好的 machine 覆盖成 bulk：一个 no-reply@
-- 地址既符合「名字就写着别回我」，也符合「每封都带群发信头且你没回过」，
-- 于是 on conflict do update 把它改了。
--
-- 功能上无所谓（两种都不是人），但档案柜里那句「为什么判掉」会变得不准——
-- 而那一页存在的全部意义就是让你看懂为什么、好翻案。所以第二遍要躲开
-- 第一遍已经判过的。
create or replace function public.pa_mail_rule_pass()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_machine int := 0; v_bulk int := 0;
begin
  -- 一、机器地址：信头上的名字就写着「别回我」。
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
    on conflict (email) do update
       set verdict = excluded.verdict, business = excluded.business,
           why = excluded.why, decided_by = 'rule', decided_at = now()
     where t.decided_by <> 'you'
    returning 1
  ) select count(*) into v_machine from w;

  -- 二、群发源：他发来的每一封都带群发信头，而且**你一封都没回过**。
  -- 「你没回过」这条很要紧：你回过的一律不自动判掉，哪怕它长得像订阅源。
  -- 判错一个真人的代价，比多留几个订阅在待判队列里大得多。
  with per as (
    select h.counterpart_email as email,
           count(*) filter (where h.direction = 'in')                as c_in,
           count(*) filter (where h.direction = 'in' and h.bulk)     as c_bulk,
           count(*) filter (where h.direction = 'out')               as c_out
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
    on conflict (email) do update
       set verdict = excluded.verdict, business = excluded.business,
           why = excluded.why, decided_by = 'rule', decided_at = now()
     where t.decided_by <> 'you' and t.verdict <> 'machine'
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
end $$;

revoke all on function public.pa_mail_rule_pass() from public, anon, authenticated;
grant execute on function public.pa_mail_rule_pass() to service_role;
