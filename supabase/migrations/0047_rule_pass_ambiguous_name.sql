-- 0045 里 pa_mail_rule_pass 有个歧义：plpgsql 变量叫 n_bulk，CTE 里的列
-- 也叫 n_bulk，Postgres 直接拒绝执行（42702 column reference is ambiguous）。
-- 变量一律加 v_ 前缀，跟列名彻底分开。
--
-- 这个函数随后被 0048 再次替换（那一刀修的是 machine 判定被 bulk 覆盖）。
-- 这条留着不删：它真跑过，是历史的一步，不是事后重写的。
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
    on conflict (email) do update
       set verdict = excluded.verdict, business = excluded.business,
           why = excluded.why, decided_by = 'rule', decided_at = now()
     where t.decided_by <> 'you'
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
