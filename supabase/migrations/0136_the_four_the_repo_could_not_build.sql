-- Producer Agent — 补上「代码在用、仓库却建不出来」的四个
--
-- 2026-08-24,workshop-edition 分支。跟 0010 是同一件事的第二半:
-- 有几支迁移当年直接应用到了生产库,没留文件。
--
-- 这四个的严重性跟 0010 那两个不同 —— **它们正在被代码调用**:
--
--   v_pa_meta           src/lib/loadLibrary.js:16  档案页读母题
--   v_pa_tasks          src/lib/loadTasks.js:9     任务列表
--   pa_stale_subjects   brain/server.js:1304       「脏了就判」那一轮
--   pa_letters_to_triage brain/server.js:1305      信件分诊
--
-- 换句话说:在补这一支之前,**任何人从这个仓库新建一个库,装出来的
-- 系统档案页和任务页会直接报错,后台那轮判断也跑不起来**。这不只是
-- workshop 的问题 —— 生产库要是没了,靠仓库复原不出一个能用的系统。
--
-- 定义照生产库 2026-08-24 的现状原样抄(pg_get_viewdef / pg_get_functiondef)。
-- 全部幂等,合并回个人版误应用到生产库不会改变任何东西。
--
-- 另外生产库里还有两个孤儿 —— pa_all_mail_ids、pa_record_labels ——
-- 代码一处都不引用,是早期版本被后来的迁移改名后留下的。**故意不补**:
-- 仓库该长出的是当前这套,不是历史沉积。

create or replace view public.v_pa_meta as
  select data -> 'concerns' as concerns
    from producer.profile
   limit 1;

grant select on public.v_pa_meta to anon, authenticated, service_role;

-- 2026-09-16 合并后:主线 0125 已经建了带排期列的 v_pa_tasks,这儿只补「还没有」的情况
-- (create or replace 不许砍列——从零建库时 0125 先跑,这一段应该是空转)。
do $$ begin
  if not exists (select 1 from pg_views where schemaname = 'public' and viewname = 'v_pa_tasks') then
    execute 'create view public.v_pa_tasks as select id, name, type, enabled, schedule, last_result, last_run_at, sort from producer.tasks';
  end if;
end $$;

grant select on public.v_pa_tasks to anon, authenticated, service_role;

-- 「脏了就判」:哪些线该重新判一遍。
create or replace function public.pa_stale_subjects(p_days integer default 30, p_limit integer default 12)
returns jsonb
language sql
security definer
set search_path to 'public', 'producer'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', f.subject_kind, 'id', f.subject_id,
           'last_in_id', f.last_in_id, 'upto', f.last_event_at)
         order by f.last_event_at desc), '[]'::jsonb)
    from (select * from public.v_pa_cue_facts
           where stale and last_event_at > now() - make_interval(days => p_days)
           order by last_event_at desc limit p_limit) f
$function$;

-- 分诊:哪几封收到的信还没判过「要不要回」。
create or replace function public.pa_letters_to_triage(p_limit integer default 20)
returns jsonb
language sql
security definer
set search_path to 'public', 'producer'
as $function$
  select coalesce(jsonb_agg(x.last_in_id), '[]'::jsonb)
    from (select distinct f.last_in_id, max(f.last_in_at) as at
            from public.v_pa_cue_facts f
           where f.last_in_id is not null
             and not coalesce(f.mail_on_line, false)
             and (f.last_out_at is null or f.last_out_at <= f.last_in_at)
             and not exists (select 1 from producer.letter_verdicts v
                              where v.gmail_message_id = f.last_in_id)
           group by f.last_in_id
           order by 2 desc limit p_limit) x
$function$;

revoke all on function public.pa_stale_subjects(integer, integer) from public;
revoke all on function public.pa_letters_to_triage(integer) from public;
grant execute on function public.pa_stale_subjects(integer, integer) to anon, authenticated, service_role;
grant execute on function public.pa_letters_to_triage(integer) to anon, authenticated, service_role;
