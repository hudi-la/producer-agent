-- 把两张卡并成一张。
--
-- 今天手工干过三次（Tom Leeser 的 .com 笔误、Qi Zhang 的三个写法、
-- Luna 的私人 Gmail），每次都要记着搬四样东西：地址、消息、thread、机构。
-- 手工再干下去迟早漏一样，而漏掉的那样会**静悄悄挂在一张已经不存在的卡上**。
--
-- 所以做成一个口，一次搬全，最后才删。顺序要紧：**先搬后删**——
-- 反过来的话 on delete cascade 会把消息一起带走。
create or replace function public.pa_merge_contacts(p_keep uuid, p_drop uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare n_mail int; n_msg int; n_thread int; n_org int; keep producer.contacts; drop_notes text;
begin
  if p_keep = p_drop then raise exception '不能把一张卡并进它自己'; end if;
  select * into keep from producer.contacts where id = p_keep;
  if keep.id is null then raise exception '要留的那张卡不存在：%', p_keep; end if;
  select notes into drop_notes from producer.contacts where id = p_drop;

  update producer.contact_emails set contact_id = p_keep where contact_id = p_drop;
  get diagnostics n_mail = row_count;

  update producer.pursuit_messages set contact_id = p_keep where contact_id = p_drop;
  get diagnostics n_msg = row_count;

  delete from producer.pursuit_threads t
   where t.contact_id = p_drop
     and exists (select 1 from producer.pursuit_threads k
                  where k.contact_id = p_keep and k.gmail_thread_id = t.gmail_thread_id);
  update producer.pursuit_threads set contact_id = p_keep where contact_id = p_drop;
  get diagnostics n_thread = row_count;

  delete from producer.contact_orgs o
   where o.contact_id = p_drop
     and exists (select 1 from producer.contact_orgs k
                  where k.contact_id = p_keep and k.org = o.org);
  update producer.contact_orgs set contact_id = p_keep where contact_id = p_drop;
  get diagnostics n_org = row_count;

  -- 被删那张卡上的备注不能就这么没了：它常常写着「他还有另一个地址」
  -- 这种只有那一张卡知道的事。并进来，别丢。
  if coalesce(btrim(drop_notes), '') <> '' and coalesce(keep.notes, '') not like '%' || drop_notes || '%' then
    update producer.contacts
       set notes = coalesce(nullif(btrim(notes), '') || E'\n', '') || drop_notes
     where id = p_keep;
  end if;

  update producer.contacts set intro_by = p_keep where intro_by = p_drop;
  delete from producer.contacts where id = p_drop;

  return jsonb_build_object('kept', p_keep, 'dropped', p_drop,
    'emails', n_mail, 'messages', n_msg, 'threads', n_thread, 'orgs', n_org);
end $$;

revoke all on function public.pa_merge_contacts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pa_merge_contacts(uuid, uuid) to anon, authenticated, service_role;
