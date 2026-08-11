-- 同步要的那几样，一次取回。
--
-- v_pa_mail_accounts 是给界面看的，故意只暴露 has_cursor 而不是 history_id
-- 本身（那是个对人没意义的 Gmail 内部序号，摆在界面上只会碍眼）。
-- 但 sync 需要真值，所以另开一个 service_role 专用的口，别为了省事把
-- 内部游标塞进那个 anon 能读的视图里。
create or replace function public.pa_mail_accounts_state()
returns jsonb
language sql security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',            a.id,
           'address',       a.address,
           'label',         a.label,
           'history_id',    a.history_id,
           'backfilled_at', a.backfilled_at,
           'headers',       (select count(*) from producer.mail_headers h where h.account_id = a.id)
         ) order by a.created_at), '[]'::jsonb)
    from producer.mail_accounts a
   where a.active;
$$;

revoke all on function public.pa_mail_accounts_state() from public, anon, authenticated;
grant execute on function public.pa_mail_accounts_state() to service_role;
