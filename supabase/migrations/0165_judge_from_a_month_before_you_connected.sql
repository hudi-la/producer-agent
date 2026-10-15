-- 0165 · 逐封判断从「连上 Gmail 前一个月」开始,按人算(2026-10-08)
--
-- 「这封要不要回、在等什么、过几天提醒」(tagPass → pa_facts_to_judge)原来只判 2026-08-03 之后的——
-- 那是他个人版开始用的那天,写死在参数默认值里。对线上的新学员不对:明年才连信箱的人,
-- 要从今年 8 月一路判过来,判的越来越多,token 白花。
-- 他定的:从每个人**连上 Gmail 的那天往前推一个月**开始判。更早的信照样搬进来、照样有摘要,只是不逐封判。
--
-- 只改 where 里那一行,别的逐字照抄线上现在的定义。invoker + RLS:mail_accounts 只看得见自己的,
-- 所以 min(created_at) 就是「我」最早连上的那个信箱。没连信箱的人(只有手记)照旧用 p_since。

create or replace function public.pa_facts_to_judge(p_since timestamp with time zone DEFAULT '2026-08-03 00:00:00+00'::timestamp with time zone, p_limit integer DEFAULT 12)
 RETURNS TABLE(id uuid, kind text, role text, created_at timestamp with time zone, subject_kind text, subject_id uuid, subject_name text, who text, content text, body_raw text, recent jsonb)
 LANGUAGE sql
 SET search_path TO 'public', 'producer'
AS $function$
  with fact as (
    select m.id, m.kind, m.role, m.created_at, m.content, m.body_raw,
           m.counterpart_email, m.contact_id,
           coalesce(pm.pursuit_id, m.pursuit_id) as pursuit_id
      from producer.pursuit_messages m
      left join lateral (
        select v.pursuit_id from public.v_pa_pursuit_mail v
         where v.id = m.id and v.on_this_line
         order by v.created_at desc limit 1
      ) pm on true
     where m.deleted_at is null
       -- 从「连上 Gmail 那天往前一个月」判起(按人算);没连邮箱(只有自己记的笔)就照旧用 p_since
       and m.created_at >= coalesce((select min(a.created_at) - interval '1 month' from producer.mail_accounts a), p_since)
       and m.created_at <= now()          -- 预约发送的信到点才是 event
       and (m.kind = 'email' or m.kind in ('note', 'meet', 'decision'))
       and not exists (select 1 from producer.message_tags t where t.message_id = m.id)
       and not exists (
         select 1 from producer.mail_headers h
          where h.gmail_message_id = m.gmail_message_id
            and (h.bulk
             or h.subject ~* '^(Accepted|Declined|Tentative|Canceled|Cancelled|Invitation|Updated invitation):'))
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
                  order by r0.created_at desc limit 3) r)
    from fact f
    left join producer.pursuits p on p.id = f.pursuit_id
    left join producer.contacts c on c.id = f.contact_id and f.pursuit_id is null
    left join producer.contacts ct on ct.id = f.contact_id
   where coalesce(f.pursuit_id, f.contact_id) is not null
   order by f.created_at asc
   limit p_limit
$function$;
