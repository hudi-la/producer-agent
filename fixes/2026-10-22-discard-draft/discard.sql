-- User-controlled, reversible dismissal; keep message association and Gmail identity.
create or replace function public.pa_set_artifact_discarded(p_id uuid, p_discarded boolean)
returns jsonb
language plpgsql
security invoker
set search_path = public, producer
as $$
declare d producer.deliverables;
begin
  if p_discarded is null then raise exception '需要指定草稿状态'; end if;
  select * into d from producer.deliverables where id = p_id for update;
  if not found then raise exception '找不到草稿或无权操作'; end if;
  if d.status <> 'draft' or d.kind <> 'email' then raise exception '只能放弃未发送的邮件草稿'; end if;
  update producer.deliverables
     set meta = case when p_discarded then coalesce(meta, '{}'::jsonb) || jsonb_build_object('artifact_discarded', true)
                     else coalesce(meta, '{}'::jsonb) - 'artifact_discarded' end
   where id = p_id returning * into d;
  return to_jsonb(d);
end
$$;
revoke all on function public.pa_set_artifact_discarded(uuid,boolean) from public, anon;
grant execute on function public.pa_set_artifact_discarded(uuid,boolean) to authenticated;
