-- Producer Agent — 办完的事有自己的一页
--
-- 他要的心安（「它自己发现这事办到了」）不做成提醒 —— 那会复发
-- 「存档假装成提醒」的病（判为不用回那层刚因此拆掉）。做成一页流水：
-- 你想看的时候伸手可得（pull），不来敲你（push）。
--
-- **一行都不新存。** 全部从已有的事实现算：
--   · 发出 / 收到的信（往来表）
--   · 你记的笔（note/meet/decision）
--   · 开了什么等待、关了什么等待（message_tags 的 awaiting / resolves —— 
--     「它自己发现办到了」就是 resolves 那一行的 why）
--   · Fairwind 到点干的活（meta.timer 的起草 / 发问）
--
-- 走 RPC 不走视图：要按天数截（PostgREST 1000 行的坑），要按当地日分组。

create or replace function public.pa_ledger(p_days int default 14)
returns table (
  at timestamptz, day date, kind text,
  subject_kind text, subject_id uuid, subject_name text,
  what text, why text
) language sql security definer set search_path = public, producer as $$
  with tz as (
    select coalesce((select p.data->>'tz' from producer.profile p limit 1),
                    'America/Los_Angeles') as z
  ),
  owned as (   -- 每条消息属于谁（跟 v_pa_state 同一套归属：on_this_line 优先）
    select m.*, coalesce(pm.pursuit_id, m.pursuit_id) as line_id
      from producer.pursuit_messages m
      left join lateral (
        select v.pursuit_id from public.v_pa_pursuit_mail v
         where v.id = m.id and v.on_this_line
         order by v.created_at desc limit 1
      ) pm on true
     where m.deleted_at is null
       and m.created_at >= now() - make_interval(days => p_days)
       and m.created_at <= now()          -- 预约发送的不算：还没发生
  ),
  named as (
    select o.*, coalesce(p.title, c.name) as who,
           case when o.line_id is not null then 'pursuit'
                when o.contact_id is not null then 'contact' end as skind,
           coalesce(o.line_id, o.contact_id) as sid
      from owned o
      left join producer.pursuits p on p.id = o.line_id
      left join producer.contacts c on c.id = o.contact_id and o.line_id is null
  ),
  rows_ as (
    -- 信：发出 / 收到
    select n.created_at, case when n.role = 'artist' then 'sent' else 'got' end as kind,
           n.skind, n.sid, n.who,
           left(regexp_replace(coalesce(n.content, ''), E'\\s+', ' ', 'g'), 120) as what,
           null::text as why
      from named n where n.kind = 'email' and n.sid is not null
    union all
    -- 你记的笔
    select n.created_at, 'note', n.skind, n.sid, n.who,
           left(regexp_replace(coalesce(n.content, ''), E'\\s+', ' ', 'g'), 120), null
      from named n where n.kind in ('note', 'meet', 'decision') and n.sid is not null
    union all
    -- 开了一个等待
    select n.created_at, 'wait_open', n.skind, n.sid, n.who,
           t.awaiting || '（' || t.wait_days || ' 天）', null
      from named n join producer.message_tags t on t.message_id = n.id
     where t.awaiting is not null and n.sid is not null
    union all
    -- 关了一个等待 —— 「它自己发现办到了」就是这一行
    select n.created_at, 'wait_close', n.skind, n.sid, n.who,
           coalesce(t.gist, '一个等待关掉了'), t.resolves_why
      from named n join producer.message_tags t on t.message_id = n.id
     where t.resolves and n.sid is not null
    union all
    -- Fairwind 到点干的活（起草 / 发问）
    select n.created_at, 'fairwind', n.skind, n.sid, n.who,
           case when n.meta ? 'letter' then '到点起草了一封（在卡里等你过目）'
                else '到点在卡里问了你一句' end,
           n.meta->'timer'->>'state'
      from named n where n.meta ? 'timer' and n.sid is not null
  )
  select r.created_at, (r.created_at at time zone tz.z)::date,
         r.kind, r.skind, r.sid, r.who, r.what, r.why
    from rows_ r cross join tz
   order by r.created_at desc
$$;

revoke all on function public.pa_ledger(int) from public;
grant execute on function public.pa_ledger(int) to anon, authenticated, service_role;
