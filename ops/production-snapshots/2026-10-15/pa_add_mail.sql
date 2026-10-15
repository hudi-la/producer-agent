CREATE OR REPLACE FUNCTION public.pa_add_mail(p_gmail_message_id text, p_counterpart text, p_role text, p_content text, p_pursuit_id uuid DEFAULT NULL::uuid, p_body_raw text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb, p_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r producer.pursuit_messages; ins boolean := false; cid uuid; is_org boolean; cp text;
        gist text; who text;
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
  values (p_pursuit_id, cid, cp, p_role, 'email', p_content, p_body_raw,
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

  -- ── 顺手落一条告知 ──
  --
  -- **跟信在同一个操作里写**，所以「信到了但没告知」这种状态做不出来。
  -- 只在真新增时落（ins），重复收同一封不会刷屏。
  if ins then
    gist := producer.first_para(coalesce(p_body_raw, p_content));
    who := case when p_role = 'org'
                then coalesce((select c.name from producer.contacts c where c.id = cid), cp)
                else '你' end;
    insert into producer.pursuit_messages
      (pursuit_id, contact_id, counterpart_email, role, kind, content, created_at, meta)
    values (p_pursuit_id, cid, cp, 'producer', 'arrival',
            coalesce(gist, '（这封信没有正文）'),
            coalesce(p_created_at, now()),
            jsonb_build_object(
              'gmail_message_id', p_gmail_message_id,
              'dir',  case when p_role = 'org' then 'in' else 'out' end,
              'who',  who,
              'msg_id', r.id));
  end if;

  return jsonb_build_object('inserted', ins, 'message', to_jsonb(r), 'contact_id', cid,
    'owner', case when cid is not null then 'person'
                  when coalesce(is_org, false) then 'org_mailbox' else 'unknown' end);
end $function$
