-- Producer Agent — 我发出去的信也算一次往来
--
-- 问题：「我发信给一个不在通讯录的地址，会怎么样？」
-- 答案是：**它在系统里等于不存在，而且没有任何地方告诉你它存在。**
--
--   ① 入库四道闸        过 —— 写进账本
--   ② 地址判定          判了，还花了钱（23 个里 22 个判过）
--   ③ 搬进对话表        **不搬** —— knownAddresses 只认通讯录 + 登记过的机构信箱
--   ④ 「还不认识的地址」 **不出现** —— 那一页读往来表，而这封没进去
--   ⑤ 归属              **不看** —— pa_orphan_inbound 第一个条件是 direction='in'
--
-- 结果：不进往来、不挂线、不出由头、对话里没有、卡上「新来信」不动。
-- 库里现有 23 个这样的地址、36 封信。
--
-- 真例：8/19 发给 adavi290@asu.edu 的那封 ——
--   「Design PhD (DEA), fall 2027 — a few questions, referred by Prof. Bogosian」
-- 系统判出「真人 · 正事」之后，就把它扔在账本里了。它该挂在 ASU 那条线上。
--
-- 病根跟这一路修的是同一个形状：**「还不认识的地址」只收「他发给我的」，
-- 不收「我发给他的」**。而主动发出去的信恰恰是最该建线、最该跟进的那种 ——
-- 冷邮件、投递、经人介绍去问一句，都是从你发出的那一封开始的。

-- ══ 一、那一页改读账本 ═════════════════════════════════════════
--
-- 原来读 pursuit_messages。可没认领的信**根本进不了**往来表（carryPass
-- 只搬认过的地址），所以那一页永远是空的 —— 查过，改之前就是 0 个。
--
-- 改读账本之后有 256 个没认领的地址，靠 address_verdicts 那道闸压到 2 个：
-- 只留判过是「真人 / 机构信箱」**且是正事**的。订阅、通知、机器一个不进。
create or replace view public.v_pa_unknown_senders as
  select h.email,
         h.封数, h.第一次, h.最近一次, h.他发来的, h.你发去的,
         coalesce(h.信头署名, v.name) as "信头署名",
         coalesce(线.titles, '{}') as "出现在哪些机会线"
    from (
      select lower(m.counterpart_email) as email,
             count(*) as "封数",
             min(m.sent_at)::date as "第一次",
             max(m.sent_at)::date as "最近一次",
             count(*) filter (where m.direction = 'in')  as "他发来的",
             count(*) filter (where m.direction = 'out') as "你发去的",
             (array_agg(m.from_name order by m.sent_at desc)
                filter (where m.direction = 'in' and m.from_name is not null))[1] as "信头署名",
             array_agg(distinct m.gmail_thread_id) as threads
        from producer.mail_headers m
       where not m.is_draft
         and m.counterpart_email is not null
         and not exists (select 1 from producer.contact_emails e
                          where lower(e.email) = lower(m.counterpart_email))
         and not exists (select 1 from producer.org_mailboxes b
                          where lower(b.email) = lower(m.counterpart_email))
       group by 1
    ) h
    join producer.address_verdicts v on v.email = h.email
    -- 信没进往来表，所以「出现在哪条线」只能靠 thread 认：
    -- 你发出去的那一封，thread 可能已经登记给某条线了
    left join lateral (
      select array_agg(distinct p.title) as titles
        from producer.pursuit_threads t
        join producer.pursuits p on p.id = t.pursuit_id
       where t.gmail_thread_id = any(h.threads)
    ) 线 on true
   where v.verdict in ('person', 'shared_box')
     and coalesce(v.business, false)
   order by h.最近一次 desc;

grant select on public.v_pa_unknown_senders to anon, authenticated, service_role;

comment on view public.v_pa_unknown_senders is
  '还不认识的地址。读账本不读往来表 —— 没认领的信根本进不了往来表，读那儿这一页永远是空的。方向不限：我发出去的冷邮件也算';

-- ══ 二、归属也别只看来信 ═══════════════════════════════════════
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

comment on function public.pa_orphan_mail(int) is
  '还没落到任何线上的往来。**方向不限** —— 旧的 pa_orphan_inbound 第一个条件是 direction=''in''，把「我主动发出去的冷邮件」全挡在外面了';

grant execute on function public.pa_orphan_mail(int) to service_role;

-- 旧的留着不删：删了是静默失败。它自己不会再被调用（attribute.js 已改）。
comment on function public.pa_orphan_inbound(int) is
  '【已停用】只看来信，漏掉了我主动发出去的。改用 pa_orphan_mail';
