-- 0170 · 密钥原文只给服务端（2026-10-24 体检，0169 的第二半）
--
-- ⚠️ 必须在 2026-10-24 那版后端上线之后才能跑（提交 538f459 或更新）。
--    新后端读密钥走 pa_member_secrets_for（0169，只给 service_role）；老后端用登录用户的会话调
--    pa_member_secrets。先跑这支、后发布 = 老后端读不到任何人的设置，全员掉线。
--
-- pa_member_secrets 返回模型 key、Claude 登录令牌、Gmail 长期令牌、MCP 令牌的原文，
-- 任何登录后的浏览器会话都调得动（只能拿到自己的）。设置页「只显示末 6 位」挡不住它。
-- 收回之后：浏览器会话调它是权限错；service_role 照旧能调。

revoke execute on function public.pa_member_secrets() from authenticated;
