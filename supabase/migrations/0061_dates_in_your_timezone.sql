-- 日期按**你住的地方**算，不按服务器。
--
-- ══ 病在哪 ═══════════════════════════════════════════════════
--
-- 库的时区是 UTC。你 8/13 下午五点按「记一笔」，存进去是
-- 2026-08-14 00:11 UTC，current_date 给的是 8/14，于是卡上写着
-- 「你记的一笔 · 2026-08-14」——而你明明是十三号写的。
--
-- 差一天这种事最阴：不报错、不崩、看着完全正常，只是**每天傍晚之后
-- 记的东西全部记到明天去**。等你哪天照着这些日期回想「我什么时候跟他
-- 聊的」，拿到的是一份系统性偏移的记忆。
--
-- 时区从档案里读（profile.data->>'tz'），没写就退回洛杉矶——
-- 档案里 location 第一个就是 Los Angeles。搬家改一处，全库跟着走。
--
-- 前端那一半在 src/lib/when.js（全 app 只有那一份 md/day）。
-- 两边必须用同一个时区，否则又回到「同一封信两个日期」。

create or replace function producer.app_tz()
returns text language sql stable set search_path = public, producer as $fn$
  select coalesce((select p.data->>'tz' from producer.profile p limit 1), 'America/Los_Angeles');
$fn$;

comment on function producer.app_tz() is
  '日期按哪个时区算。UTC 会让傍晚之后的一切记到明天去——差一天不报错、不崩，但它会静静毁掉「我什么时候跟他聊的」这件事';

create or replace function producer.today_local()
returns date language sql stable set search_path = public, producer as $fn$
  select (now() at time zone producer.app_tz())::date;
$fn$;

-- ── 盖日期的几个口子改成按当地算 ──────────────────────────────
create or replace function public.pa_add_contact_message(
  p_contact_id uuid, p_role text, p_content text,
  p_kind text default 'message', p_meta jsonb default '{}'::jsonb
) returns producer.pursuit_messages
language plpgsql security definer set search_path = public as $fn$
declare r producer.pursuit_messages;
begin
  insert into producer.pursuit_messages (contact_id, role, kind, content, meta)
  values (p_contact_id, p_role, coalesce(nullif(btrim(p_kind), ''), 'message'),
          p_content, coalesce(p_meta, '{}'::jsonb))
  returning * into r;
  if p_role = 'note' and p_kind = 'meet' then
    update producer.contacts
       set last_touch_at = producer.today_local(), last_touch_src = 'meet'
     where id = p_contact_id;
  end if;
  return r;
end $fn$;
grant execute on function public.pa_add_contact_message(uuid, text, text, text, jsonb)
  to anon, authenticated, service_role;

create or replace function public.pa_contact_checkin(p_contact_id uuid)
returns void language sql security definer set search_path = public as $fn$
  update producer.contacts
     set last_touch_at = producer.today_local(), last_touch_src = 'checkin'
   where id = p_contact_id;
$fn$;
grant execute on function public.pa_contact_checkin(uuid) to anon, authenticated, service_role;

create or replace function public.pa_mark_intro_thanked(p_contact_id uuid)
returns void language sql security definer set search_path = public as $fn$
  update producer.contacts set intro_thanked_at = producer.today_local() where id = p_contact_id;
$fn$;
grant execute on function public.pa_mark_intro_thanked(uuid) to anon, authenticated, service_role;

-- 收信：一封信算哪天来的，也按当地
create or replace function public.pa_add_mail(
  p_gmail_message_id text, p_counterpart text, p_role text, p_content text,
  p_pursuit_id uuid default null, p_body_raw text default null,
  p_meta jsonb default '{}'::jsonb, p_created_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare r producer.pursuit_messages; ins boolean := false; cid uuid; is_org boolean; cp text;
begin
  if p_role not in ('org', 'artist') then
    raise exception 'email 的 role 只能是 org|artist，收到 %', p_role;
  end if;
  cp := lower(btrim(p_counterpart));
  if cp = '' or cp is null then
    raise exception '对面地址不能为空——没有它就没法判断这封信是谁的，而猜就是 0033 犯的错';
  end if;
  if coalesce(btrim(p_gmail_message_id), '') = '' then
    raise exception 'gmail_message_id 不能为空——没有它就没法去重';
  end if;

  select e.contact_id into cid from producer.contact_emails e where lower(e.email) = cp;
  select true into is_org from producer.org_mailboxes b where lower(b.email) = cp;

  insert into producer.pursuit_messages
    (pursuit_id, contact_id, counterpart_email, role, kind, content, body_raw,
     gmail_message_id, meta, created_at)
  values (p_pursuit_id, cid, cp, p_role, 'message', p_content, p_body_raw,
          p_gmail_message_id, coalesce(p_meta, '{}'::jsonb), coalesce(p_created_at, now()))
  on conflict do nothing
  returning * into r;

  if found then ins := true; else
    select * into r from producer.pursuit_messages
     where gmail_message_id = p_gmail_message_id
       and (contact_id is not distinct from cid or pursuit_id is not distinct from p_pursuit_id)
     limit 1;
  end if;

  if cid is not null then
    update producer.contacts
       set last_touch_at = greatest(coalesce(last_touch_at, date '1900-01-01'),
             (coalesce(p_created_at, now()) at time zone producer.app_tz())::date),
           last_touch_src = 'email'
     where id = cid;
  end if;

  return jsonb_build_object('inserted', ins, 'message', to_jsonb(r), 'contact_id', cid,
    'owner', case when cid is not null then 'person'
                  when coalesce(is_org, false) then 'org_mailbox' else 'unknown' end);
end $fn$;
revoke all on function public.pa_add_mail(text, text, text, text, uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.pa_add_mail(text, text, text, text, uuid, text, jsonb, timestamptz)
  to service_role;

-- ── 已经存下来的日期重算一遍 ──────────────────────────────────
-- 这些是过去按 UTC 算出来的，傍晚那些差着一天。信本身一个字没动。
update producer.contacts c
   set last_touch_at = x.d
  from (select contact_id,
               max((created_at at time zone producer.app_tz())::date) as d
          from producer.pursuit_messages
         where contact_id is not null and gmail_message_id is not null
         group by contact_id) x
 where c.id = x.contact_id and c.last_touch_src = 'email'
   and c.last_touch_at is distinct from x.d;

do $$
declare tz text; n int;
begin
  select producer.app_tz() into tz;
  select count(*) into n from producer.contacts where last_touch_at is not null;
  raise notice '✓ 日期改按 % 算，% 个人的「上次碰」重算过了', tz, n;
end $$;
