CREATE OR REPLACE FUNCTION public.pa_upsert_contact(p_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_org text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_channels jsonb DEFAULT NULL::jsonb, p_intro_by uuid DEFAULT NULL::uuid, p_next_touch_at date DEFAULT NULL::date, p_next_touch_why text DEFAULT NULL::text, p_cadence_days integer DEFAULT NULL::integer)
 RETURNS producer.contacts
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r producer.contacts;
begin
  if p_id is null then
    insert into producer.contacts
      (name, email, org, role, notes, channels, intro_by,
       next_touch_at, next_touch_why, cadence_days)
    values (p_name, nullif(btrim(p_email), ''), p_org, p_role, p_notes,
            coalesce(p_channels, '[]'::jsonb), p_intro_by,
            p_next_touch_at, p_next_touch_why, p_cadence_days)
    returning * into r;
  else
    update producer.contacts set
      name           = coalesce(p_name, name),
      email          = coalesce(nullif(btrim(p_email), ''), email),
      org            = coalesce(p_org, org),
      role           = coalesce(p_role, role),
      notes          = coalesce(p_notes, notes),
      channels       = coalesce(p_channels, channels),
      intro_by       = coalesce(p_intro_by, intro_by),
      next_touch_at  = coalesce(p_next_touch_at, next_touch_at),
      next_touch_why = coalesce(p_next_touch_why, next_touch_why),
      cadence_days   = coalesce(p_cadence_days, cadence_days)
     where id = p_id
     returning * into r;
    if r.id is null then raise exception '没有这个人：%', p_id; end if;
  end if;
  return r;
end $function$
