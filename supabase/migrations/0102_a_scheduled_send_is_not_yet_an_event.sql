-- Producer Agent — 预约发送的信还不是 event
--
-- 真事（2026-08-19 晚）：你在 Gmail 里给 Brooke 排了一封明早 10 点的信。
-- Gmail 对预约发送的信在 history 里**不给 labelIds**，于是「我发的、
-- 没 SENT 就拦」那道闸（0075/0082）摸了个空 —— 它以「你发出」的身份
-- 进了账本和卡面，自查当场亮了两条红（没核标签、时间戳在未来）。
--
-- 处置（他定的）：**不藏，标清楚。** 信照旧显示在卡里，界面标「预约发送」，
-- 到点自然变回「你发出」。库这边两刀：
--
-- 一、判断队列不收未来的信：created_at <= now() 才排队。妙处是预约的信
--     **到点自己变成 event**——它真送出去那一刻才被判、才起等待倒计时。
--     取消了的（Gmail 里删掉）永远不到点，audit 的 gone 会认出它。
--
-- 二、自查那条「时间戳在未来」改盯真正的红线：未来的信**存在**可以
--     （那是你亲手排的），**被提前判了**不行 —— 判了就等于拿一封可能
--     被取消的信去起倒计时。

create or replace function public.pa_facts_to_judge(
  p_since timestamptz default '2026-08-03',
  p_limit int default 12
) returns table (
  id uuid, kind text, role text, created_at timestamptz,
  subject_kind text, subject_id uuid,
  subject_name text,
  who text,
  content text, body_raw text,
  recent jsonb
) language sql security definer set search_path = public, producer as $$
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
       and m.created_at >= p_since
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
$$;

-- ── 自查跟着改（函数全文重放，只动上面说的两条）──
create or replace function public.pa_selfcheck()
returns table (组 text, 检查 text, 期望 text, 实际 text, 通过 boolean)
language plpgsql
security definer
set search_path = public, producer
as $$
declare v text; e text;
begin
  -- ══ 账本：库里的信都是 Gmail 里真收发过的 ══════════════════
  组 := '账本';

  检查 := '每封信头都核过 Gmail 标签';
  期望 := '0 封没核';
  -- 预约发送豁免：Gmail 对还没送出的信不给 labelIds，没什么可核的；
  -- 到点送出后下一轮 sweep 自然把 SENT 的审计补上。取消了的由
  -- 「往来表里混着假信」那条兜住（audit 的 gone）。
  select count(*)::text into v from producer.mail_headers h
   where h.sent_at <= now()
     and not exists (select 1 from producer.mail_label_audit a
                      where a.gmail_message_id = h.gmail_message_id);
  实际 := v || ' 封没核'; 通过 := v = '0'; return next;

  检查 := '我们记的方向 vs Gmail 说的';
  期望 := '0 条不一致';
  select count(*)::text into v from producer.mail_headers h
    join producer.mail_label_audit a on a.gmail_message_id = h.gmail_message_id
   where not a.gone and a.labels is not null
     and ((h.direction='out' and not ('SENT'=any(a.labels)) and not h.is_draft)
       or (h.direction='in'  and ('SENT'=any(a.labels))));
  实际 := v || ' 条不一致'; 通过 := v = '0'; return next;

  检查 := '标成「没发出」的，Gmail 同不同意';
  期望 := '0 条标错';
  select count(*)::text into v from producer.mail_headers h
    join producer.mail_label_audit a on a.gmail_message_id = h.gmail_message_id
   where h.is_draft and not a.gone and a.labels is not null and 'SENT'=any(a.labels);
  实际 := v || ' 条标错'; 通过 := v = '0'; return next;

  检查 := '往来表里混着假信（草稿 / 没发出的 / Gmail 里没有的）';
  期望 := '0 条';
  select count(*)::text into v from producer.pursuit_messages m
    join producer.mail_label_audit a on a.gmail_message_id = m.gmail_message_id
   where m.deleted_at is null and m.kind='email'
     and (a.gone or a.labels is null or 'DRAFT'=any(a.labels)
          or (m.role='artist' and not ('SENT'=any(a.labels))));
  实际 := v || ' 条'; 通过 := v = '0'; return next;

  检查 := '往来表里有账本查不到的信';
  期望 := '0 条';
  select count(*)::text into v from producer.pursuit_messages m
   where m.gmail_message_id is not null and m.deleted_at is null
     and not exists (select 1 from producer.mail_headers h
                      where h.gmail_message_id = m.gmail_message_id);
  实际 := v || ' 条'; 通过 := v = '0'; return next;

  -- 0102 改：预约发送的信**存在**是许可的（他在 Gmail 里亲手排的，
  -- 界面标着「预约发送」）；红线是它**被提前判了**——判了就等于拿一封
  -- 可能被取消的信起了倒计时。到点它自己变成 event，那时候判才作数。
  检查 := '时间戳在未来的信被提前判了（预约发送到点才是 event）';
  期望 := '0 条';
  select count(*)::text into v from producer.pursuit_messages m
    join producer.mail_headers h on h.gmail_message_id = m.gmail_message_id
    join producer.message_tags t on t.message_id = m.id
   where m.kind='email' and m.deleted_at is null and h.sent_at > now();
  实际 := v || ' 条'; 通过 := v = '0'; return next;

  -- ══ 归类：kind 说的和事实一致 ══════════════════════════════
  组 := '归类';

  检查 := 'kind=email 的都有 gmail_message_id';
  期望 := '0 条没有';
  select count(*)::text into v from producer.pursuit_messages
   where kind='email' and deleted_at is null and gmail_message_id is null;
  实际 := v || ' 条没有'; 通过 := v = '0'; return next;

  检查 := 'kind=message 的都没有 gmail_message_id（那是跟 Fairwind 的商量）';
  期望 := '0 条有';
  select count(*)::text into v from producer.pursuit_messages
   where kind='message' and deleted_at is null and gmail_message_id is not null;
  实际 := v || ' 条有'; 通过 := v = '0'; return next;

  检查 := 'kind=gmail_draft 的在账本里都标着 is_draft';
  期望 := '0 条对不上';
  select count(*)::text into v from producer.pursuit_messages m
    left join producer.mail_headers h on h.gmail_message_id = m.gmail_message_id
   where m.kind='gmail_draft' and m.deleted_at is null
     and coalesce(h.is_draft, false) = false;
  实际 := v || ' 条对不上'; 通过 := v = '0'; return next;

  检查 := '每封真信都有原文（没有的会在框上标「摘要」）';
  期望 := '0 封缺原文';
  select count(*)::text into v from producer.pursuit_messages
   where kind='email' and deleted_at is null and body_raw is null;
  实际 := v || ' 封缺原文'; 通过 := v = '0'; return next;

  -- ══ 口径：三处读「这条线上有哪些信」必须一致 ════════════════
  组 := '口径';

  检查 := '对话读到的信 = on_this_line 算的信';
  期望 := '0 条线对不上';
  select count(*)::text into v from (
    select p.id from producer.pursuits p
     where (select count(*) from public.v_pa_pursuit_thread t
             where t.pursuit_id = p.id and t.kind='email')
        <> (select count(*) from public.v_pa_pursuit_mail vm
             where vm.pursuit_id = p.id and vm.on_this_line and vm.kind='email')) z;
  实际 := v || ' 条线对不上'; 通过 := v = '0'; return next;

  检查 := '事实视图的「最后一封来信」= on_this_line 算的最后一封';
  期望 := '0 条线对不上';
  select count(*)::text into v from public.v_pa_cue_facts f
   where f.subject_kind='pursuit'
     and f.last_in_at is distinct from (
       select max(m.created_at) from public.v_pa_pursuit_mail vm
         join producer.pursuit_messages m on m.id = vm.id and m.deleted_at is null
        where vm.pursuit_id = f.subject_id and vm.on_this_line
          and vm.kind='email' and vm.role='org');
  实际 := v || ' 条线对不上'; 通过 := v = '0'; return next;

  -- ══ 派生值：存下来的必须跟事实一致 ═════════════════════════
  组 := '派生值';

  检查 := '「上次碰」= 真信的最后一封（打卡 / 见面更晚的除外）';
  期望 := '0 个人对不上';
  select count(*)::text into v from producer.contacts c
   where c.last_touch_src = 'email'
     and c.last_touch_at is distinct from (
       select max((m.created_at at time zone producer.app_tz())::date)
         from producer.pursuit_messages m
        where m.contact_id = c.id and m.kind='email' and m.deleted_at is null);
  实际 := v || ' 个人对不上'; 通过 := v = '0'; return next;

  检查 := '该碰日和它的出处，要么都有要么都没有';
  期望 := '0 条只有一半';
  select (
    (select count(*) from producer.pursuits
      where (next_touch_at is null) <> (next_touch_why is null)) +
    (select count(*) from producer.contacts
      where (next_touch_at is null) <> (next_touch_why is null))
  )::text into v;
  实际 := v || ' 条只有一半'; 通过 := v = '0'; return next;

  -- ══ 约束：写口挡不挡得住坏数据 ═════════════════════════════
  组 := '约束';

  检查 := 'pa_set_next_touch 只给日期不给出处 → 必须抛错';
  期望 := '抛错';
  begin
    perform public.pa_set_next_touch('pursuit',
      (select id from producer.pursuits limit 1), current_date, null);
    实际 := '没抛，写进去了'; 通过 := false;
  exception when others then
    实际 := '抛了'; 通过 := true;
  end;
  return next;

  检查 := 'pa_add_mail 的 role 只收 org|artist';
  期望 := '抛错';
  begin
    perform public.pa_add_mail('__chk__', 'x@y.z', 'producer', 'x');
    实际 := '没抛'; 通过 := false;
  exception when others then
    实际 := '抛了'; 通过 := true;
  end;
  return next;

  检查 := 'pa_mark_judged 不许拿 null 推水位';
  期望 := '返回 false';
  select public.pa_mark_judged('pursuit',
    (select id from producer.pursuits limit 1), null)::text into v;
  实际 := '返回 ' || v; 通过 := v = 'false'; return next;
end $$;
