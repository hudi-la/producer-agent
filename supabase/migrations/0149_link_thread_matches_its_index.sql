-- Producer Agent — pa_link_thread 对不上它的唯一索引,一直在报错
--
-- 0033 把 pursuit_threads 的唯一索引改成了**部分索引**(pt_by_pursuit … where pursuit_id is not null),
-- 但 0027 写的 pa_link_thread 还是 `on conflict (pursuit_id, gmail_thread_id)`,没带 where——
-- Postgres 找不到匹配的约束,整条 insert 抛 42P10。brain 里两处归线(server.js 里 pa_link_thread)
-- 从那以后就没成功过,只是错被 catch 掉了。2026-09-25 挂第三位学员时撞出来。
create or replace function public.pa_link_thread(p_pursuit_id uuid, p_thread_id text, p_added_by text default 'you')
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
begin
  if p_pursuit_id is null or coalesce(btrim(p_thread_id), '') = '' then
    raise exception '归线要有卡和信串';
  end if;
  insert into producer.pursuit_threads (pursuit_id, gmail_thread_id, added_by)
  values (p_pursuit_id, btrim(p_thread_id), p_added_by)
  on conflict (pursuit_id, gmail_thread_id) where pursuit_id is not null do nothing;
end
$$;
revoke all on function public.pa_link_thread(uuid, text, text) from public;
grant execute on function public.pa_link_thread(uuid, text, text) to anon, authenticated, service_role;
