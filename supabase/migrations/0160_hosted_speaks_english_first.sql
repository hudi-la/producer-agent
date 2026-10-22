-- 0160 · 托管版新账号默认英文(2026-10-03 他定的)
--
-- member_settings.lang 的默认值从 'zh' 改成 'en';没传 lang 时的兜底也跟着换。
-- 出厂找机会任务的提示词由脑子按账号语言换(brain/hosted/routes.js 的 /me,isSeedPrompt 判断还是原样才换)。
-- 本机版不读这张表(语言在 settings.json 里,首启自己选),不受影响。
alter table producer.member_settings alter column lang set default 'en';
