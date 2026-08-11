-- 第一批真判定跑完，抽查抓出两件事。
--
-- ══ 一、共享信箱不是垃圾 ═══════════════════════════════════════
--
-- classify 原来把 shared_box 折进 machine，然后强制 business=false。
-- 于是 festiwalabstrakcji.lodz@gmail.com——罗兹抽象艺术节的主办方信箱，
-- 跟他 80 封往来、给他出过 O-1 支持信——被静默丢掉了。
--
-- 共享信箱**不是人**（硬当成人的话往来会归错到某个倒霉蛋头上，那是 0033
-- 犯过的错），但它**跟业务高度相关**。库里早就有 org_mailboxes 这张表就是
-- 为它准备的。所以它该是一种独立的判定，走「登记成机构信箱」那条路。
alter table producer.address_verdicts drop constraint if exists av_verdict_chk;
alter table producer.address_verdicts add constraint av_verdict_chk
  check (verdict in ('person', 'shared_box', 'bulk', 'machine', 'unsure'));

comment on column producer.address_verdicts.verdict is
  'person 一个人 / shared_box 机构共享信箱（不是人，但可能很重要）/ bulk 群发源 / machine 系统自动 / unsure 认不出';

-- ══ 二、我自己的地址不该出现在待判池里 ═════════════════════════
--
-- 「我发给我自己」那种信，counterpart 算出来就是我自己（addr.js 里当时
-- 只保证「不炸」）。结果他自己的邮箱混进候选，模型还认真判了一条
-- 「这是他自己的邮箱」——判得没错，但这个问题根本不该问。
delete from producer.address_verdicts v
 where exists (select 1 from producer.mail_accounts a where lower(a.address) = v.email);

create or replace function public.pa_address_candidates(p_limit int default 50)
returns jsonb
language sql security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(c), '[]'::jsonb) from (
    select jsonb_build_object(
      'email',    h.counterpart_email,
      'name',     (array_agg(h.from_name order by h.sent_at desc)
                     filter (where h.direction = 'in' and h.from_name is not null))[1],
      'domain',   split_part(h.counterpart_email, '@', 2),
      'in',       count(*) filter (where h.direction = 'in'),
      'out',      count(*) filter (where h.direction = 'out'),
      'bulk',     count(*) filter (where h.bulk),
      'first',    min(h.sent_at)::date,
      'last',     max(h.sent_at)::date,
      'subjects', (array_agg(h.subject order by h.sent_at desc) filter (where h.subject is not null))[1:5]
    ) as c
    from producer.mail_headers h
    where not exists (select 1 from producer.address_verdicts v where v.email = h.counterpart_email)
      and not exists (select 1 from producer.contact_emails e where lower(e.email) = h.counterpart_email)
      and not exists (select 1 from producer.org_mailboxes b where lower(b.email) = h.counterpart_email)
      -- ↓ 我自己的地址不是「对面」。自己发给自己的信不该产生一个待认联系人。
      and not exists (select 1 from producer.mail_accounts a where lower(a.address) = h.counterpart_email)
    group by h.counterpart_email
    order by count(*) filter (where h.direction = 'out') desc, count(*) desc
    limit greatest(p_limit, 1)
  ) t;
$$;

-- ══ 三、读面跟着改 ═════════════════════════════════════════════
--
-- 「等你点头」现在有两种：加成一个人，或者登记成机构信箱。
-- 界面按 verdict 分岔，数据这边一次给全。
-- （加了一列，所以要 drop 再建——create or replace 改不了列序。）
drop view if exists public.v_pa_greetable;
create view public.v_pa_greetable as
  select v.email, v.verdict, v.name, v.org, v.role, v.why, v.decided_by, v.decided_at,
         s.n_in, s.n_out, s.first_at, s.last_at, s.subjects
    from producer.address_verdicts v
    join lateral (
      select count(*) filter (where h.direction = 'in')  as n_in,
             count(*) filter (where h.direction = 'out') as n_out,
             min(h.sent_at)::date as first_at,
             max(h.sent_at)::date as last_at,
             (array_agg(h.subject order by h.sent_at desc) filter (where h.subject is not null))[1:3] as subjects
        from producer.mail_headers h
       where lower(h.counterpart_email) = v.email
    ) s on true
   where v.verdict in ('person', 'shared_box')
     and coalesce(v.business, false)
     and v.greeted_at is null
     and not exists (select 1 from producer.contact_emails e where lower(e.email) = v.email)
     and not exists (select 1 from producer.org_mailboxes b where lower(b.email) = v.email)
     and not exists (select 1 from producer.mail_accounts a where lower(a.address) = v.email)
   order by s.n_out desc, s.last_at desc;

grant select on public.v_pa_greetable to anon, authenticated, service_role;
revoke all on function public.pa_address_candidates(int) from public, anon, authenticated;
grant execute on function public.pa_address_candidates(int) to service_role;
