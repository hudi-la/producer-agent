-- Persist the search queue after each bounded model call. RLS on producer.tasks
-- scopes every write to the authenticated owner, including hosted brain sessions.
create or replace function public.pa_scout_checkpoint(
  p_id uuid, p_progress jsonb, p_result text default null, p_delay_minutes int default null
)
returns void language plpgsql security invoker set search_path = public, producer as $$
begin
  if p_delay_minutes is not null and (p_delay_minutes < 1 or p_delay_minutes > 10080) then
    raise exception 'invalid scout delay';
  end if;
  update producer.tasks
     set config = case when p_progress is null
                       then coalesce(config, '{}'::jsonb) - 'scout_progress'
                       else jsonb_set(coalesce(config, '{}'::jsonb), '{scout_progress}', p_progress, true) end,
         last_result = coalesce(p_result, last_result),
         running_since = case when p_delay_minutes is null then running_since else null end,
         next_run_at = case when p_delay_minutes is null then next_run_at
                            else now() + make_interval(mins => p_delay_minutes) end
   where id = p_id;
  if not found then raise exception 'scout task not found'; end if;
end $$;

revoke all on function public.pa_scout_checkpoint(uuid, jsonb, text, int) from public, anon;
grant execute on function public.pa_scout_checkpoint(uuid, jsonb, text, int) to authenticated, service_role;
