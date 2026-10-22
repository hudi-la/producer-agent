-- Producer Agent — 见面这个环要能合上
--
-- 三件事：
--
-- 一、**线上的见面也欠 48 小时信**。0079 的「见过面」只算 contact ——
--     多人 / 对公的会面记在线卡上（kind='meet'），原来没人接。
--     v_pa_state 补一支：线上有 meet、之后没发过信 → OWE_MEETING_NOTE。
--
-- 二、**谢介绍人要有落笔的口子**。owe_thanks 的关法是
--     contacts.intro_thanked_at，而判「这封信谢过了吗」的是 brain ——
--     它判了 resolves 之后得有地方落：pa_thank_introducer(介绍人) 把
--     ta 名下没谢过的一次性标掉（一封谢信提几个人，就是一次谢几条）。
--
-- 三、**到点动作带上「这条线上有谁」**。合并规则（同一个人跨两卡的草稿
--     并进后发生的卡）要在起草那一刻判 —— timerPass 得知道人卡上这位
--     是不是也在哪条到点的线上。
--
-- 设计稿：docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md 第五、六节

-- ── 一 ──
create or replace view public.v_pa_state
with (security_invoker = off) as
with owned as (
  select t.*, m.created_at as at,
         case when coalesce(pm.pursuit_id, m.pursuit_id) is not null then 'pursuit'
              when m.contact_id is not null then 'contact' end as subject_kind,
         coalesce(pm.pursuit_id, m.pursuit_id, m.contact_id) as subject_id
    from producer.message_tags t
    join producer.pursuit_messages m
      on m.id = t.message_id and m.deleted_at is null and m.kind <> 'gmail_draft'
    left join lateral (
      select v.pursuit_id from public.v_pa_pursuit_mail v
       where v.id = m.id and v.on_this_line
       order by v.created_at desc limit 1
    ) pm on true
),
opening as (
  select *,
         case when awaiting is not null then 'WAITING_REPLY'
              when needs_reply          then 'NEEDS_REPLY'
              when meet_at is not null  then 'MEETING_SET' end as opened
    from owned
   where subject_id is not null
     and (awaiting is not null or needs_reply or meet_at is not null)
),
current_open as (
  select distinct on (subject_kind, subject_id) *
    from opening o
   where not exists (
           select 1 from owned r
            where r.subject_kind = o.subject_kind and r.subject_id = o.subject_id
              and r.at > o.at and r.resolves)
     and not (o.opened = 'NEEDS_REPLY' and exists (
           select 1 from producer.pursuit_messages n
            where ((o.subject_kind = 'pursuit' and n.pursuit_id = o.subject_id)
                or (o.subject_kind = 'contact' and n.contact_id = o.subject_id))
              and n.kind in ('note', 'meet', 'decision')
              and n.deleted_at is null and n.created_at > o.at))
   order by subject_kind, subject_id, at desc
),
tag_state as (
  select subject_kind, subject_id,
         case when opened = 'MEETING_SET' and now() > meet_at + interval '1 hour'
              then 'DEBRIEF' else opened end as state,
         coalesce(awaiting, gist, reply_why) as what,
         reply_why as why,
         at as since_at,
         case opened
           when 'WAITING_REPLY' then at + make_interval(days => wait_days)
           when 'NEEDS_REPLY'   then at
           else meet_at end as due_at,
         message_id as anchor_id
    from current_open
),
owe_meet as (
  -- 人：0079 的判据照旧
  select 'contact'::text as subject_kind, f.subject_id,
         'OWE_MEETING_NOTE'::text as state,
         '和「' || f.name || '」meeting 了，回复一下。' as what,
         null::text as why,
         f.last_meet_at as since_at,
         f.last_meet_at + interval '48 hours' as due_at,
         null::uuid as anchor_id
    from public.v_pa_cue_facts f
   where f.subject_kind = 'contact'
     and f.last_meet_at is not null and not f.met_followed_up
  union all
  -- 线：多人 / 对公的会面记在线卡上。见面之后这条线没发过信 → 欠一封
  select 'pursuit', mm.pursuit_id, 'OWE_MEETING_NOTE',
         '「' || p.title || '」meeting 了，回复一下。',
         null, mm.at, mm.at + interval '48 hours', null
    from (select m.pursuit_id, max(m.created_at) as at
            from producer.pursuit_messages m
           where m.pursuit_id is not null and m.kind = 'meet' and m.deleted_at is null
           group by 1) mm
    join producer.pursuits p on p.id = mm.pursuit_id
   where not exists (
           select 1 from public.v_pa_pursuit_mail v
            where v.pursuit_id = mm.pursuit_id and v.on_this_line
              and v.kind = 'email' and v.role = 'artist' and v.created_at > mm.at)
),
owe_thanks as (
  select 'contact'::text, i.id, 'OWE_THANKS'::text,
         '见到了你经「' || i.name || '」介绍认识的 '
           || string_agg('「' || c.name || '」', '、' order by ev.at) || '，跟他说一声谢谢。',
         null::text,
         max(ev.at), max(ev.at), null::uuid
    from producer.contacts c
    join producer.contacts i on i.id = c.intro_by
    join lateral (
      select greatest(f.last_in_at, f.last_meet_at) as at, f.org_ever_replied, f.last_meet_at
        from public.v_pa_cue_facts f
       where f.subject_kind = 'contact' and f.subject_id = c.id
    ) ev on ev.org_ever_replied or ev.last_meet_at is not null
   where c.intro_thanked_at is null
   group by i.id, i.name
)
select distinct on (subject_kind, subject_id)
       x.subject_kind, x.subject_id, x.state, x.what, x.why,
       x.since_at, x.due_at,
       case when x.state in ('MEETING_SET')
              then case when (x.due_at at time zone producer.app_tz())::date
                          <= (now() at time zone producer.app_tz())::date
                        then 'due' else 'waiting' end
            when x.due_at <= now() then 'due'
            else 'waiting' end as zone,
       x.anchor_id
  from (
    select * from tag_state
    union all select * from owe_meet
    union all select * from owe_thanks
  ) x
 order by subject_kind, subject_id, since_at desc;

grant select on public.v_pa_state to anon, authenticated, service_role;

-- ── 二 ──
-- 一封谢信谢掉这个介绍人名下所有还没谢的。今天谢的是今天联系上的这几位；
-- 以后 ta 再介绍新人，intro_thanked_at 是 null，会重新欠。
create or replace function public.pa_thank_introducer(p_introducer uuid)
returns int language sql security definer set search_path = public, producer as $$
  with done as (
    update producer.contacts
       set intro_thanked_at = producer.today_local()
     where intro_by = p_introducer and intro_thanked_at is null
    returning 1)
  select count(*)::int from done;
$$;
revoke all on function public.pa_thank_introducer(uuid) from public;
grant execute on function public.pa_thank_introducer(uuid) to anon, authenticated, service_role;

-- ── 三 ──
drop function if exists public.pa_due_actions();
create or replace function public.pa_due_actions()
returns table (
  subject_kind text, subject_id uuid, state text, what text, why text,
  since_at timestamptz, due_at timestamptz, anchor_id uuid,
  subject_name text, days_over int, acted boolean, allowed boolean,
  contact_ids uuid[]
) language sql security definer set search_path = public, producer as $$
  select s.subject_kind, s.subject_id, s.state, s.what, s.why,
         s.since_at, s.due_at, s.anchor_id,
         coalesce(p.title, c.name) as subject_name,
         greatest(0, (now()::date - s.due_at::date)) as days_over,
         exists (
           select 1 from producer.pursuit_messages pm
            where pm.deleted_at is null
              and pm.meta->'timer'->>'key' =
                  s.state || ':' || s.subject_id || ':' || (s.since_at)::date
         ) as acted,
         (s.subject_kind = 'pursuit'
          or exists (select 1 from producer.contacts c2
                      where c2.id = s.subject_id
                        and c2.created_at >= timestamptz '2026-08-03')) as allowed,
         case when s.subject_kind = 'pursuit' then
           coalesce((select array_agg(distinct pp.contact_id)
                       from producer.pursuit_parties pp
                      where pp.pursuit_id = s.subject_id and pp.contact_id is not null), '{}')
         else null end as contact_ids
    from public.v_pa_state s
    left join producer.pursuits p on s.subject_kind = 'pursuit' and p.id = s.subject_id
    left join producer.contacts c on s.subject_kind = 'contact' and c.id = s.subject_id
   where s.zone = 'due'
   order by s.due_at
$$;
revoke all on function public.pa_due_actions() from public;
grant execute on function public.pa_due_actions() to anon, authenticated, service_role;
