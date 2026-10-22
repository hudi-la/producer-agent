-- 你记的一次接触，也能算在某条机会线上
--
-- 「我记的」长在**人**身上——你是跟这个人见的面、通的电话。
-- 但那次聊的内容常常跟某条线直接相关（"跟 Weidi 通了话，他让我申请
-- Design School 下面"），那条线上也该看得见。
--
-- 不是搬过去，是**同时挂两边**：pursuit_messages 早就能同时有
-- pursuit_id 和 contact_id（0033 那条 check 是「至少有一个」，不是「只能有一个」）。
-- 所以这一刀只是把口子开出来，结构一个字没动。
--
-- 为什么不让 AI 猜该挂哪条线：这个人可能挂着三条线，猜错了那段记忆就
-- 长在错的项目上——而项目卡是你写申请时照着看的东西，污染它比留空更糟。
-- 你记的时候顺手选一下，一秒钟的事。

create or replace function public.pa_add_contact_message(
  p_contact_id uuid,
  p_role       text,
  p_content    text,
  p_kind       text  default 'message',
  p_meta       jsonb default '{}'::jsonb,
  p_pursuit_id uuid  default null          -- 也算在这条线上（可不填）
) returns producer.pursuit_messages
language plpgsql security definer set search_path = public as $fn$
declare r producer.pursuit_messages;
begin
  if p_pursuit_id is not null
     and not exists (select 1 from producer.pursuits where id = p_pursuit_id) then
    raise exception '没有这条机会线：%', p_pursuit_id;
  end if;

  insert into producer.pursuit_messages
    (contact_id, pursuit_id, role, kind, content, meta)
  values (p_contact_id, p_pursuit_id, p_role,
          coalesce(nullif(btrim(p_kind), ''), 'message'), p_content,
          coalesce(p_meta, '{}'::jsonb))
  returning * into r;

  -- 记一次接触同时干三件事：更新「上次碰」、触发 48 小时由头、
  -- 留下「上次聊到哪」。不是三个功能，是同一笔。
  if p_role = 'note' and p_kind = 'meet' then
    update producer.contacts
       set last_touch_at = (now() at time zone producer.app_tz())::date,
           last_touch_src = 'meet'
     where id = p_contact_id;
  end if;

  return r;
end $fn$;

-- 旧签名（5 个参数）留着不删：外面可能还有调用方按老参数调。
-- 新参数有默认值，所以 5 参调用会命中新函数——但 Postgres 里两个同名
-- 不同参数个数的函数会并存，调 5 参时会「函数不唯一」。所以明确删掉旧的。
drop function if exists public.pa_add_contact_message(uuid, text, text, text, jsonb);

grant execute on function public.pa_add_contact_message(uuid, text, text, text, jsonb, uuid)
  to anon, authenticated, service_role;

comment on function public.pa_add_contact_message(uuid, text, text, text, jsonb, uuid) is
  '你说的话 / 你记的一次接触。p_pursuit_id 可选——记的东西跟某条线有关就一起挂上，那条线的卷宗里也看得见。同时挂两边，不是搬过去';
