-- Producer Agent — 脑子跨所有人找活:pa_tasks_due_all / pa_briefs_due_all
--
-- 设计稿 docs/specs/2026-10-02-hosted-fairwind-design.md 的 D4 和 六.1。
--
-- ── 为什么要这两个口 ───────────────────────────────────────────
--
-- 托管版一个脑子伺候所有人。后台两个循环——「谁的任务到点了」(scoutPass)、
-- 「谁有新机会还没读」(sweepBriefs)——今天各走一条**以一个人的身份**的查询:
-- pa_tasks_due(0125)和 v_pa_pursuits where stage = 'pending'。它们是 invoker,
-- RLS 之下只见调用者自己的行;脑子要替所有人干活,先得知道**活在谁名下**。
--
-- 规矩(D4):**service_role 找活,换身份干活。** 这两个函数是脑子仅有的两个
-- 越过 RLS 的入口,它们只做一件事:返回 (owner, …),让脑子拿着 owner 去造
-- 那个人的会话(tenantForOwner),然后在那个人的身份下执行。它们**从不写**。
-- 脑子代码里永远不出现「以 service_role 写业务表」。
--
-- 所以它们是 0152 规矩的唯一例外(security definer),而且只授 service_role——
-- authenticated 调它是权限错,anon 更不用说。机器判在
-- brain/local/privileges.test.js(白名单就这两个名字)和 scripts/isolation-test.mjs。
--
-- ── 形状 ───────────────────────────────────────────────────────
--
-- pa_tasks_due_all  → (owner uuid, id uuid, task jsonb)
--   谓词逐字抄 pa_tasks_due;task = to_jsonb(整行),跟 pa_tasks_due 返回的数组里
--   每个元素同形——脑子的 runScoutTask 拿到的对象不用换形状。排序同样按 sort。
--   多一句 owner is not null:无主的行对任何人都不可见(0137),脑子没有身份能替它
--   干活,返回了只会在 tenantForOwner(null) 上炸。
--
-- pa_briefs_due_all → (owner uuid, id uuid, title text)
--   谓词抄 brain/server.js sweepBriefs 今天读的那条:stage = 'pending',按 created_at。
--   直接读 producer.pursuits,不走 v_pa_pursuits——那个视图为了看板挂了好几个
--   lateral join,sweepBriefs 只要 id 和 title。

create or replace function public.pa_tasks_due_all()
returns table (owner uuid, id uuid, task jsonb)
language sql
security definer
set search_path = producer, public
as $$
  select t.owner, t.id, to_jsonb(t) as task
    from producer.tasks t
   where t.owner is not null
     and t.prompt is not null
     and (t.running_since is null or t.running_since < now() - interval '2 hours')
     and (t.run_now or (t.enabled and t.next_run_at is not null and t.next_run_at <= now()))
   order by t.owner, t.sort;
$$;

create or replace function public.pa_briefs_due_all()
returns table (owner uuid, id uuid, title text)
language sql
security definer
set search_path = producer, public
as $$
  select p.owner, p.id, p.title
    from producer.pursuits p
   where p.owner is not null
     and p.stage = 'pending'
   order by p.created_at;
$$;

comment on function public.pa_tasks_due_all()  is '脑子找活:所有人到点的任务 (owner, id, task)。security definer,只授 service_role,只读。拿到 owner 后在那个人的身份下干活。';
comment on function public.pa_briefs_due_all() is '脑子找活:所有人待读的新机会 (owner, id, title)。security definer,只授 service_role,只读。拿到 owner 后在那个人的身份下干活。';

revoke all on function public.pa_tasks_due_all()  from public, anon, authenticated;
revoke all on function public.pa_briefs_due_all() from public, anon, authenticated;
grant execute on function public.pa_tasks_due_all()  to service_role;
grant execute on function public.pa_briefs_due_all() to service_role;
