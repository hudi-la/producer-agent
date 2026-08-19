-- Producer Agent — 库这边的自查
--
-- JS 那半有 335 条测试（node --test）。**SQL 这半一条都没有**，
-- 而由头要用的事实、信怎么归类、读面的口径，一多半在 SQL 里。
--
-- 这个仓库没有 SQL 测试框架，也不该为此装一个。改成一个随时能跑的自查：
-- 每条返回「检查 / 期望 / 实际 / 通过没通过」，全绿才算库是干净的。
--
--   select * from public.pa_selfcheck() where not 通过;
--
-- 加一条判据的时候，这儿也加一条 —— 否则 SQL 那半永远是「我记得是对的」。
--
-- 开发文档：docs/dev/mail-classification.md · docs/dev/judgments.md

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
  select count(*)::text into v from producer.mail_headers h
   where not exists (select 1 from producer.mail_label_audit a
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

  检查 := '时间戳在未来的信（定时发送不算发出）';
  期望 := '0 条';
  select count(*)::text into v from producer.pursuit_messages m
    join producer.mail_headers h on h.gmail_message_id = m.gmail_message_id
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

comment on function public.pa_selfcheck() is
  '库这边的自查。加判据的时候这儿也加一条 —— 否则 SQL 那半永远是「我记得是对的」';

grant execute on function public.pa_selfcheck() to service_role;
