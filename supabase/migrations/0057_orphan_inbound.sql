-- 「还没落到任何一条线上」的近期来信，按地址收拢。
--
-- 判断层只该问这些——不是拿全部 3400 封去问。绝大多数轮次这个集合是空的，
-- 一次模型调用都不用花。
--
-- 谁会落进来：机械层（pa_link_replies）靠 RFC 的 References 认亲，盖住
-- 「对方点回复」的绝大多数。剩下的是另起一封新信那种——PAM 那个 Cristina
-- 就是：你发给 info@pam.usc.edu，她用 ch45852@usc.edu 新写一封回你。
--
-- 三条筛选，都是为了别问废话：
--   · 只要**他发来**的（你自己发出去的不需要归属判断）
--   · 只要判定是真人或机构共享信箱、而且跟业务相关的
--   · 只要**还没出现在任何一条线上**的
create or replace function public.pa_orphan_inbound(p_days int default 30)
returns jsonb
language sql security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x order by x->>'last_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'email',      h.counterpart_email,
      'name',       coalesce(v.name, c.name),
      'why',        v.why,
      'is_mailbox', exists (select 1 from producer.org_mailboxes b
                             where lower(b.email) = h.counterpart_email),
      'contact_id', (select e.contact_id from producer.contact_emails e
                      where lower(e.email) = h.counterpart_email limit 1),
      'n',          count(*),
      'first_at',   min(h.sent_at)::date,
      'last_at',    max(h.sent_at)::date,
      'subjects',   (array_agg(h.subject order by h.sent_at desc)
                       filter (where h.subject is not null))[1:5]
    ) as x
    from producer.mail_headers h
    join producer.address_verdicts v on v.email = h.counterpart_email
    left join producer.contact_emails ce on lower(ce.email) = h.counterpart_email
    left join producer.contacts c on c.id = ce.contact_id
    where h.direction = 'in'
      and h.sent_at > now() - make_interval(days => greatest(p_days, 1))
      and v.verdict in ('person', 'shared_box')
      and coalesce(v.business, false)
      -- 已经在某条线上了就不用问
      and not exists (
        select 1 from public.v_pa_pursuit_mail m
         where m.gmail_message_id = h.gmail_message_id)
    group by h.counterpart_email, v.name, c.name, v.why
  ) t;
$$;

revoke all on function public.pa_orphan_inbound(int) from public, anon, authenticated;
grant execute on function public.pa_orphan_inbound(int) to service_role;
