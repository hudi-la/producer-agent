-- Producer Agent — 登记过的共享信箱，归属挂得上
--
-- 真事（Stanford，2026-08-20）：归属判断**高把握**把那封「提案已收到」
-- 对到了 Stanford 线，却在挂的那步被「还没进通讯录」拦下 ——
-- pa_orphan_mail 的返回里根本没有 is_mailbox 字段，attribute 读
-- r.is_mailbox 永远 undefined，登记过的信箱等于永远没登记。
-- 补上这个字段（查 org_mailboxes 登记簿），其余与 0091 一字不差。

create or replace function public.pa_orphan_mail(p_days int)
returns jsonb
language sql security definer set search_path = public, producer
as $$
  select coalesce(jsonb_agg(t.x), '[]'::jsonb) from (
    select jsonb_build_object(
      'email',      h.counterpart_email,
      'name',       coalesce(c.name, v.name),
      'why',        v.why,
      'contact_id', (select e.contact_id from producer.contact_emails e
                      where lower(e.email) = h.counterpart_email limit 1),
      -- 0107 补：登记过的共享信箱要认得出来。原来这个字段压根不存在，
      -- attribute 那边读 r.is_mailbox 永远 undefined —— 于是高把握判中了
      -- 也挂不上（「还没进通讯录」），Stanford 那封确认信就卡在这儿。
      'is_mailbox', exists (select 1 from producer.org_mailboxes b
                             where b.email = h.counterpart_email),
      'n',          count(*),
      'first_at',   min(h.sent_at)::date,
      'last_at',    max(h.sent_at)::date,
      -- 方向给出去：模型要知道这是「他找你」还是「你去问人家」
      'dirs',       jsonb_build_object(
                      'in',  count(*) filter (where h.direction = 'in'),
                      'out', count(*) filter (where h.direction = 'out')),
      'subjects',   (array_agg(h.subject order by h.sent_at desc)
                       filter (where h.subject is not null))[1:5]
    ) as x
    from producer.mail_headers h
    join producer.address_verdicts v on v.email = h.counterpart_email
    left join producer.contact_emails ce on lower(ce.email) = h.counterpart_email
    left join producer.contacts c on c.id = ce.contact_id
    where h.sent_at > now() - make_interval(days => greatest(p_days, 1))
      and not h.is_draft
      and v.verdict in ('person', 'shared_box')
      and coalesce(v.business, false)
      -- 已经在某条线上了就不用问
      and not exists (
        select 1 from public.v_pa_pursuit_mail m
         where m.gmail_message_id = h.gmail_message_id)
    group by h.counterpart_email, v.name, c.name, v.why
  ) t;
$$;
