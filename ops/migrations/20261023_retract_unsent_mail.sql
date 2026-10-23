-- Reconcile provider-confirmed drafts / outgoing messages without SENT.
-- Caller is the mailbox owner's authenticated client; retain content and release dedup keys.
create or replace function public.pa_retract_unsent_mail(p_gmail_message_id text, p_reason text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare who uuid := auth.uid(); n int; ids uuid[]; contacts uuid[];
begin
  if who is null then raise exception 'Authentication required'; end if;
  if p_reason not in ('draft','unverified_outgoing') or p_reason is null then raise exception 'Invalid mail evidence'; end if;
  if coalesce(btrim(p_gmail_message_id),'')='' then raise exception 'Message ID required'; end if;
  perform 1 from producer.mail_headers where owner=who and gmail_message_id=p_gmail_message_id for update;
  perform 1 from producer.pursuit_messages where owner=who and gmail_message_id=p_gmail_message_id for update;
  select array_agg(id), array_agg(distinct contact_id) into ids, contacts
    from producer.pursuit_messages where owner=who and gmail_message_id=p_gmail_message_id and kind='email';
  -- Only roll back the last-touch value if it actually came from a retracted email.
  update producer.contacts c set last_touch_at=(
      select max(m.created_at) from producer.pursuit_messages m
      where m.owner=who and m.contact_id=c.id and m.kind='email' and m.deleted_at is null
        and not (m.id=any(coalesce(ids,'{}'::uuid[]))))
    where c.owner=who and c.id=any(coalesce(contacts,'{}'::uuid[])) and c.last_touch_src='email'
      and exists(select 1 from producer.pursuit_messages m where m.id=any(ids)
        and m.contact_id=c.id and (m.created_at at time zone producer.app_tz())::date=c.last_touch_at);
  update producer.pursuit_messages m set deleted_at=coalesce(deleted_at,now()),
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('mail_state_correction',p_reason,
      'original_gmail_message_id',p_gmail_message_id,'mail_state_checked_at',now()),
    gmail_message_id=null, kind=case when kind='email' then 'gmail_draft' else kind end
    where owner=who and (id=any(coalesce(ids,'{}'::uuid[])) or
      (kind='arrival' and deleted_at is null and meta->>'gmail_message_id'=p_gmail_message_id));
  get diagnostics n=row_count;
  -- This is derived metadata. Removing it lets the later SENT event enter normally.
  delete from producer.mail_headers where owner=who and gmail_message_id=p_gmail_message_id;
  return jsonb_build_object('retracted',n);
end $$;
revoke all on function public.pa_retract_unsent_mail(text,text) from public, anon;
grant execute on function public.pa_retract_unsent_mail(text,text) to authenticated;
