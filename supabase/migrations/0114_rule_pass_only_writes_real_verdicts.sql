-- Producer Agent — 规则判地址：判断没变就不要写库
--
-- 这个函数挂在 brain 每 5 分钟一轮的收信里，用纯规则（不叫模型、不花钱）
-- 把明显是机器发的、群发的地址判掉，结果写进 producer.address_verdicts。
--
-- 问题（2026-08-21 查出来）：它每一轮把所有符合条件的地址**整批重写一遍**，
-- 不管判断结果有没有变化——写进去的 verdict / business / why 跟上次一模一样，
-- 只有 decided_at 变成了 now()。54 天写了 659,827 次，占全库写入的 82.5%。
--
-- 后果不是磁盘，是流量：库里任何一行被改，前端的改动计数器就加 1，
-- 所有开着的标签页就重新下载看板（161 KB）。也就是说每 5 分钟一次
-- 「什么都没发生」的重新下载，一天约 576 次。而看板的依赖链里
-- **根本没有 address_verdicts**——这些下载在数学上不可能改变屏幕上任何一个字。
--
-- 改法：upsert 的 where 加一句「新旧真的不同才更新」。
-- 一个判断程序不该每 5 分钟宣称自己有了新结论。
--
-- 附带的语义变化（是好事）：返回的 machine / bulk 计数从「碰过几行」变成
-- 「这一轮真判出了几个新的」。brain 只拿它打日志，那句日志本来就该是这个意思。

create or replace function public.pa_mail_rule_pass()
returns jsonb
language plpgsql security definer set search_path to 'public'
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
    on conflict (email) do update
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
    on conflict (email) do update
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
