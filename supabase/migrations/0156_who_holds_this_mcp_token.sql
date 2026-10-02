-- 0156 · 这串 MCP 令牌是谁的(设计稿 2026-10-02 D13、第九节)
--
-- 线上 /mcp 不再只认本机回环:桥带着 member_settings.mcp_token 来,脑子得先知道「这是谁」,
-- 才能换成他的身份建上下文。查令牌时还没有任何身份,所以这一个函数只能是 definer,
-- 而且**只授 service_role**(脑子找活那把钥匙)——跟 0155 的两个 _all 同一类:只读、只给服务器。
create or replace function public.pa_owner_of_mcp_token(p_token text)
returns uuid
language sql
security definer
set search_path = producer, public
as $$
  select owner from producer.member_settings
  where p_token is not null and length(p_token) >= 16 and mcp_token = p_token
  limit 1
$$;

revoke all on function public.pa_owner_of_mcp_token(text) from public, anon, authenticated;
grant execute on function public.pa_owner_of_mcp_token(text) to service_role;
