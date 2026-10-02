-- Producer Agent — 关上五道后门:9/16 之后写回 security definer 的函数改回 invoker,anon 一律收回
--
-- 设计稿 docs/specs/2026-10-02-hosted-fairwind-design.md 的 D11。
--
-- ── 病 ─────────────────────────────────────────────────────────
--
-- 0137 把全部 pa_* 翻成了 security invoker:函数以调用者的身份跑,表上的
-- 行级权限(owner = auth.uid())自动管住它。「什么算你的行」只在一个地方定义。
-- 0139 顺手立了规矩:**此后任何重定义 pa_* 的迁移不得写 security definer。**
--
-- 但 9/16 之后合进来的五支迁移又写了 definer,而且授给了 anon:
--
--   0145  pa_set_entry_box        0146  pa_set_entry_box_json
--   0148  pa_restart_studio       0148  pa_rewind_studio
--   0149  pa_link_thread
--
-- definer = 以函数主人(postgres)的身份跑,RLS 对它不生效。拿着别人的 id 调
-- pa_set_entry_box,改的就是别人的盒子;pa_rewind_studio 能撤掉别人的对话。
-- 单人本机版看不出来(一个库一个人),多人托管版这就是五道绕过门的后门。
-- 授给 anon 则是另一层:没登录的也能调——单人版里 anon 是「他自己的手」,
-- 多人版里 anon 是任何人。
--
-- ── 刀法 ───────────────────────────────────────────────────────
--
-- 一、五个函数**照最新的函数体原样重定义**,只把 security definer 换成
--     security invoker。函数体一个字不动:行为的差别全部来自 RLS——
--     「找不到这条」从今天起包括「这条不是你的」。
-- 二、然后按目录扫 **public 里今天存在的每一个 pa_***:revoke 掉 anon 和
--     public,保证 authenticated + service_role 有 execute。按 pg_proc 循环,
--     不写清单,0150/0151 新加的函数也一并盖到。
--
-- 规矩重申,并从今天起有机器判(brain/local/privileges.test.js 和
-- scripts/isolation-test.mjs 的「目录检查」):
--
--   **0137 之后重定义 pa_* 的迁移不得写 security definer,不得授给 anon。**
--   唯一的例外是 0155 脑子找活的两个只读口(pa_tasks_due_all / pa_briefs_due_all),
--   它们只授 service_role。再加例外要进测试里的白名单,带理由。

-- ── 一、五个函数:definer → invoker,函数体不动 ───────────────────

-- 0145 pa_set_entry_box
create or replace function public.pa_set_entry_box(
  p_id    uuid,
  p_key   text,
  p_value text
)
returns void
language plpgsql
security invoker
set search_path = public, producer
as $$
declare k text;
begin
  if p_id is null then
    raise exception '要补哪一条？没给 id';
  end if;

  k := btrim(coalesce(p_key, ''));
  if k = '' then
    raise exception '这一条得有个名字（为什么是现在 / 想触达 / 隐线 / 材料 / 备注……）';
  end if;

  update producer.works
     set box = coalesce(box, '{}'::jsonb) || jsonb_build_object(k, coalesce(p_value, ''))
   where id = p_id;

  if not found then raise exception '库里没有这条（id=%）', p_id; end if;
end
$$;

-- 0146 pa_set_entry_box_json
create or replace function public.pa_set_entry_box_json(
  p_id    uuid,
  p_key   text,
  p_value jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, producer
as $$
declare k text;
begin
  if p_id is null then raise exception '要改哪一条？没给 id'; end if;
  k := btrim(coalesce(p_key, ''));
  if k = '' then raise exception '盒子里这一格得有个名字'; end if;
  update producer.works
     set box = case when p_value is null or p_value = 'null'::jsonb
                    then coalesce(box, '{}'::jsonb) - k
                    else coalesce(box, '{}'::jsonb) || jsonb_build_object(k, p_value) end
   where id = p_id;
  if not found then raise exception '库里没有这条（id=%）', p_id; end if;
end
$$;

-- 0148 pa_restart_studio
create or replace function public.pa_restart_studio(p_entry_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, producer
as $$
declare
  last_kind text;
  r producer.studio_messages;
begin
  if p_entry_id is null then
    raise exception 'entry_id 不能为空';
  end if;

  -- 空对话、或者上一条已经是线了：再划一道是两条紧挨着的线，没有意义。
  -- 静悄悄返回 null，界面据此不画第二条。
  select m.kind into last_kind
    from producer.studio_messages m
   where m.entry_id = p_entry_id and m.deleted_at is null
   order by m.created_at desc, m.id desc
   limit 1;
  if last_kind is null or last_kind = 'restart' then
    return null;
  end if;

  insert into producer.studio_messages (entry_id, role, kind, content)
  values (p_entry_id, 'system', 'restart', '从这儿重开一轮')
  returning * into r;

  return to_jsonb(r);
end
$$;

-- 0148 pa_rewind_studio
create or replace function public.pa_rewind_studio(p_msg_id uuid)
returns int
language plpgsql
security invoker
set search_path = public, producer
as $$
declare
  a producer.studio_messages;
  n int;
begin
  select * into a from producer.studio_messages where id = p_msg_id;
  if not found then
    raise exception '库里没有这条（id=%）', p_msg_id;
  end if;
  if a.deleted_at is not null then
    raise exception '这条已经撤过了';
  end if;
  if a.role <> 'artist' then
    raise exception '只能从你自己说的一句话往后撤（这条是 role=%）', a.role;
  end if;

  -- 「从这句起」用行比较：同一毫秒落库的两条（你那句和它的回复偶尔会撞上）
  -- 也有确定的先后，不会漏一条也不会多撤一条。
  update producer.studio_messages m
     set deleted_at = now()
   where m.entry_id = a.entry_id
     and (m.created_at, m.id) >= (a.created_at, a.id)
     and m.deleted_at is null
     and m.kind <> 'restart';

  get diagnostics n = row_count;
  return n;
end
$$;

-- 0149 pa_link_thread
create or replace function public.pa_link_thread(p_pursuit_id uuid, p_thread_id text, p_added_by text default 'you')
returns void
language plpgsql
security invoker
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

-- ── 二、按目录扫:今天存在的每一个 public.pa_*,anon / public 收回,
--        authenticated + service_role 保证有 ────────────────────────
-- 跟 0137 第四段同一把刀,再挥一次——盖到 0137 之后新建的全部函数。
-- (不在这里改 definer/invoker:那是上面逐个明写的事,目录循环只管授权。)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'pa\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
