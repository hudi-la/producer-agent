-- Producer Agent — 已判过的事实（给「看看会怎么变」用）
--
-- 2026-09-16，workshop-edition。学员改了判据文档之后要能看见差别：拿最近判过的 N 件事，
-- 用现在的判据再判一遍，跟原来的结论并排。pa_facts_to_judge 只给**没判过的**（那是队列），
-- 这支给**判过的**，同一副形状，多两列：当时落在哪一格（situation）、当时的结论（old_tag）。
--
-- 0137 之后重定义 pa_* 的迁移不得写 security definer——这支是 invoker，行级权限照管。

create or replace function public.pa_judged_facts(p_limit int default 20)
returns table (
  id uuid, kind text, role text, created_at timestamptz,
  subject_kind text, subject_id uuid,
  subject_name text,
  who text,
  content text, body_raw text,
  recent jsonb,
  situation text,
  old_tag jsonb
) language sql security invoker set search_path = public, producer as $$
  with fact as (
    select m.id, m.kind, m.role, m.created_at, m.content, m.body_raw,
           m.counterpart_email, m.contact_id,
           coalesce(pm.pursuit_id, m.pursuit_id) as pursuit_id,
           t.situation,
           jsonb_build_object('needs_reply', t.needs_reply, 'reply_why', t.reply_why,
                              'awaiting', t.awaiting, 'wait_days', t.wait_days,
                              'meet_at', t.meet_at, 'gist', t.gist,
                              'resolves', t.resolves, 'resolves_why', t.resolves_why,
                              'tagged_at', t.tagged_at) as old_tag
      from producer.pursuit_messages m
      join producer.message_tags t on t.message_id = m.id
      left join lateral (
        select v.pursuit_id from public.v_pa_pursuit_mail v
         where v.id = m.id and v.on_this_line
         order by v.created_at desc limit 1
      ) pm on true
     where m.deleted_at is null
       and (m.kind = 'email' or m.kind in ('note', 'meet', 'decision'))
       and t.situation like '% x %'
  )
  select f.id, f.kind, f.role, f.created_at,
         case when f.pursuit_id is not null then 'pursuit' else 'contact' end,
         coalesce(f.pursuit_id, f.contact_id),
         coalesce(p.title, c.name),
         coalesce(ct.name, f.counterpart_email),
         f.content, f.body_raw,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   '日', (r.created_at at time zone producer.app_tz())::date,
                   '谁', case when r.kind <> 'email' then '你记的笔'
                              when r.role = 'artist' then '你' else '对方' end,
                   '说', left(regexp_replace(coalesce(r.body_raw, r.content, ''), E'\\s+', ' ', 'g'), 420)
                 ) order by r.created_at), '[]'::jsonb)
            from (select r0.* from producer.pursuit_messages r0
                   left join lateral (
                     select v.pursuit_id from public.v_pa_pursuit_mail v
                      where v.id = r0.id and v.on_this_line limit 1
                   ) rpm on true
                  where r0.deleted_at is null and r0.created_at < f.created_at
                    and (r0.kind = 'email' or r0.kind in ('note','meet','decision'))
                    and ((f.pursuit_id is not null
                          and coalesce(rpm.pursuit_id, r0.pursuit_id) = f.pursuit_id)
                      or (f.pursuit_id is null and r0.contact_id = f.contact_id))
                  order by r0.created_at desc limit 3) r),
         f.situation, f.old_tag
    from fact f
    left join producer.pursuits p on p.id = f.pursuit_id
    left join producer.contacts c on c.id = f.contact_id and f.pursuit_id is null
    left join producer.contacts ct on ct.id = f.contact_id
   where coalesce(f.pursuit_id, f.contact_id) is not null
   order by f.created_at desc
   limit p_limit
$$;

revoke all on function public.pa_judged_facts(int) from public, anon;
grant execute on function public.pa_judged_facts(int) to authenticated, service_role;
