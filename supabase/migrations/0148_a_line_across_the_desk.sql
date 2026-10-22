-- 书桌上划一道线：从这儿重开一轮。
--
-- 病：一条对话越聊越长，聊完一个话题想换个方向，Fairwind 还背着前面
-- 几十句在想 —— 你说「换个思路重写」，它写出来的还是上一版的延续。
--
-- ── 为什么是划线，不是「存档 + 开新的」 ──────────────────────
--
-- 「把这一轮存起来、开一个空的」听着更干净，但那等于：**行还在库里，
-- 界面上再也看不见**。他定过一条规矩：改动不许让已有信息消失或不可见
-- ——「看不见 = 丢了」。存档要成立，就还欠一个「翻旧对话」的界面，
-- 而那是他明说暂时不做的。
--
-- 所以线以上的照常摆在那儿，往上滚就看得见。变的只有一件事：
-- **Fairwind 的 prompt 只读最后一道线以下的**（brain/studio.js 的 historyBlock）。
--
-- 划线本身是一条消息（role='system', kind='restart'）。不另开一张表、
-- 不给 works 加一列「当前第几轮」：那样「线在哪儿」就有了第二个真相，
-- 而两个真相迟早对不上。线就在流里，它自己说自己在哪儿。

create or replace function public.pa_restart_studio(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
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

-- 给 anon：这是**他自己在整理自己的对话**，跟「重说」一路。
-- 脑子开没开，不该影响他划一道线。
revoke all on function public.pa_restart_studio(uuid) from public;
grant execute on function public.pa_restart_studio(uuid) to anon, authenticated, service_role;

-- 「重说」不许撤掉线。
--
-- 照 0127 那支整段重写，只多了一句 and m.kind <> 'restart'。为什么：
-- 界面那头撤是用 rewind.js 的 dropFrom 算的，它只撤「你跟 Fairwind 的一来一回」
-- （role artist/producer + kind message）。两边判据不一样的话，屏幕上线还在、
-- 库里已经没了 —— 而你不会察觉，只会发现它忽然又记得上一轮的事。
create or replace function public.pa_rewind_studio(p_msg_id uuid)
returns int
language plpgsql
security definer
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

revoke all on function public.pa_rewind_studio(uuid) from public;
grant execute on function public.pa_rewind_studio(uuid) to anon, authenticated, service_role;
