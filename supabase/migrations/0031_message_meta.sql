-- 群发那句要标明它是群发的。
--
-- pursuit_messages.meta 这一列早就有（0027 用它存邮件的 subject/from_name），
-- 但写消息的口子 pa_add_message（0009）没开 meta 参数，所以记号存不进去。
--
-- 为什么不把「同时发给了 6 条线」拼进 content：那样记号成了正文的一部分，
-- 而且会当成**你说的话**塞进 prompt，Fairwind 会看见一句莫名其妙的
-- 「同时发给了 6 条线」。跟 next_action_by 不能用文本前缀是同一个理由（0029）。
--
-- 加默认值参数会生成一个新签名（4 参和 5 参并存），所以先把旧的删掉——
-- 0019 治过一次两个重载并存的乱子，不重蹈。删了要重新 grant。

drop function if exists public.pa_add_message(uuid, text, text, text);

create or replace function public.pa_add_message(
  p_pursuit_id uuid,
  p_role       text,
  p_content    text,
  p_kind       text  default 'message',
  p_meta       jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, producer
as $function$
declare r producer.pursuit_messages;
begin
  if p_role not in ('artist', 'producer', 'system', 'note') then
    raise exception 'role 只能是 artist|producer|system|note，收到 %', p_role;
  end if;
  if coalesce(btrim(p_content), '') = '' then
    raise exception 'content 不能为空';
  end if;

  insert into producer.pursuit_messages (pursuit_id, role, kind, content, meta)
  values (p_pursuit_id, p_role, coalesce(nullif(btrim(p_kind), ''), 'message'), p_content, coalesce(p_meta, '{}'::jsonb))
  returning * into r;

  return to_jsonb(r);
end
$function$;

revoke all on function public.pa_add_message(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.pa_add_message(uuid, text, text, text, jsonb) to service_role;
