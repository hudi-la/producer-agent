-- 补录：这条迁移线上已经跑过（20260810060501 / 0038_attribution_by_address），当时没落成文件。
-- 此文件由 supabase_migrations.schema_migrations.statements 逐字 dump，不是事后重写的。

-- 归属由地址决定，不再从机会线倒推
--
-- 0033 ① 犯的错是判据错了：「这条线挂了谁，邮件就都是谁的」。
-- 一条机会线的对面从来不是一个人（CultureHub 那条先后是 Stacy、共享箱、Mattie），
-- 所以那个判据必然出错，而且错得静悄悄。
--
-- 唯一靠得住的判据是**信头上的对面地址**。这一刀把它变成一等公民：
--   1. 每封邮件必须记下 counterpart_email
--   2. 归属由地址查 contact_emails / org_mailboxes 决定，写在函数里
--   3. 查不到就**明说不认识**，不猜、不硬塞给谁

alter table producer.pursuit_messages
  add column if not exists counterpart_email text;
create index if not exists pm_counterpart_idx
  on producer.pursuit_messages (lower(counterpart_email)) where counterpart_email is not null;

-- 0037 把核对来的地址临时放在 meta 里，搬进正式列
update producer.pursuit_messages
   set counterpart_email = meta->>'counterpart'
 where counterpart_email is null and meta ? 'counterpart';

comment on column producer.pursuit_messages.counterpart_email is
  '对面那个地址。归属的唯一判据——contact_emails 命中就归那个人，org_mailboxes 命中就是机构信箱（只归线），都不命中就是还不认识的地址（见 v_pa_unknown_senders）。别再从机会线倒推：一条线的对面从来不是一个人';

-- ══ 收信的唯一入口：地址进来，归属自己算出来 ═══════════════════
-- brain 只负责把信头照抄进来，**它不判断这是谁**——判断在这个函数里，
-- 而且判断只有一条：查表。查不到就 contact_id 留空，绝不硬塞。
create or replace function public.pa_add_mail(
  p_gmail_message_id text,
  p_counterpart      text,                    -- 对面地址，必填
  p_role             text,
  p_content          text,
  p_pursuit_id       uuid        default null,
  p_body_raw         text        default null,
  p_meta             jsonb       default '{}'::jsonb,
  p_created_at       timestamptz default null
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
                                    coalesce(p_created_at, now())::date),
           last_touch_src = 'email'
     where id = cid;
  end if;

  return jsonb_build_object(
    'inserted', ins, 'message', to_jsonb(r),
    'contact_id', cid,
    'owner', case when cid is not null then 'person'
                  when coalesce(is_org, false) then 'org_mailbox'
                  else 'unknown' end);
end $fn$;
revoke all on function public.pa_add_mail(text, text, text, text, uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.pa_add_mail(text, text, text, text, uuid, text, jsonb, timestamptz)
  to service_role;

-- ══ 还不认识的地址：系统自己列出来，不假装认识 ═════════════════
-- 这张表就是「加个人」的真正入口：你不用去哪儿贴 URL，
-- 系统已经知道有个陌生地址在跟你来往，只等你说他是谁。
create or replace view public.v_pa_unknown_senders as
  select m.counterpart_email as email,
         count(*)                       as 封数,
         min(m.created_at)::date        as 第一次,
         max(m.created_at)::date        as 最近一次,
         count(*) filter (where m.role = 'org')    as 他发来的,
         count(*) filter (where m.role = 'artist') as 你发去的,
         (array_agg(m.meta->>'from_name' order by m.created_at desc)
            filter (where m.meta->>'from_name' is not null))[1] as 信头署名,
         (array_agg(distinct p.title))[1:3] as 出现在哪些机会线
    from producer.pursuit_messages m
    left join producer.pursuits p on p.id = m.pursuit_id
   where m.gmail_message_id is not null
     and m.counterpart_email is not null
     and m.contact_id is null
     and not exists (select 1 from producer.org_mailboxes b
                      where lower(b.email) = lower(m.counterpart_email))
   group by m.counterpart_email
   order by 2 desc;
grant select on public.v_pa_unknown_senders to anon, authenticated, service_role;

-- ══ 认领一个陌生地址：归到某个人，历史一起补 ═══════════════════
-- 这是「今后自动处理」的收口：你说一次「这个地址是 Stacy 的」，
-- 那个地址名下**所有历史往来**当场归位——不用重跑迁移，不用手工挑信。
create or replace function public.pa_claim_email(
  p_email text, p_contact_id uuid, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare em text; n int;
begin
  em := lower(btrim(p_email));
  if em = '' then raise exception '地址不能为空'; end if;
  if exists (select 1 from producer.org_mailboxes b where lower(b.email) = em) then
    raise exception '% 是机构共享信箱，不该归给某个人', em;
  end if;
  insert into producer.contact_emails (contact_id, email, note)
  values (p_contact_id, em, p_note)
  on conflict (lower(email)) do update set contact_id = excluded.contact_id;

  update producer.pursuit_messages
     set contact_id = p_contact_id
   where lower(counterpart_email) = em and contact_id is distinct from p_contact_id;
  get diagnostics n = row_count;

  update producer.contacts c
     set last_touch_at = x.d, last_touch_src = 'email'
    from (select max(created_at)::date d from producer.pursuit_messages
           where contact_id = p_contact_id and gmail_message_id is not null) x
   where c.id = p_contact_id and x.d is not null;

  return jsonb_build_object('email', em, 'moved', n);
end $fn$;
grant execute on function public.pa_claim_email(text, uuid, text)
  to anon, authenticated, service_role;

-- 把一个地址认成机构共享箱（它不是人）
create or replace function public.pa_mark_org_mailbox(
  p_email text, p_org text, p_label text default null, p_notes text default null
) returns void
language plpgsql security definer set search_path = public as $fn$
declare em text;
begin
  em := lower(btrim(p_email));
  insert into producer.org_mailboxes (org, email, label, notes)
  values (p_org, em, p_label, p_notes)
  on conflict (lower(email)) do update
    set org = excluded.org, label = excluded.label, notes = excluded.notes;
  -- 机构信箱的往来不归任何人，只归机会线
  update producer.pursuit_messages set contact_id = null
   where lower(counterpart_email) = em and contact_id is not null;
end $fn$;
grant execute on function public.pa_mark_org_mailbox(text, text, text, text)
  to anon, authenticated, service_role;
