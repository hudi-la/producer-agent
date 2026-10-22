-- Producer Agent — 补上「直接应用、没留文件」的那几支
--
-- 2026-08-24,workshop-edition 分支。**这支是补历史的,不是新功能。**
--
-- 发现经过:第一次拿空库从零重放全部迁移(scripts/db-reset.mjs --wipe),
-- 107 支里只成功建出 11 张表(生产库有 25 张)。失败链的源头是第 6 支
-- 0011_outreach.sql 报 `column p.kind does not exist`——而仓库里没有任何
-- 一支迁移给 producer.pursuits 加过 kind 列。
--
-- 对账生产库的迁移历史才看清:早期有若干支是直接应用到库里的,**没留下
-- 文件**。历史前 24 支里,仓库只有 17 个文件,缺的包括:
--   producer_pursuit_kind / producer_public_views /
--   pa_set_stage_rpc / pa_set_fields_rpc /
--   ball_only_real_correspondence / user_actions_write_direct / pa_ball_two_states
--
-- 后果不只是 workshop 装不起来:**这个仓库没法重建它自己的数据库**。
-- 生产库要是没了,靠仓库是复原不出来的。这支开始把这个洞补上。
--
-- 全部写成幂等(if not exists / or replace):这支将来合并回个人版、
-- 万一被应用到生产库,不会改变任何东西。
--
-- 列的类型照生产库现状抄(2026-08-24 读的):
--   kind          text,可空,无默认
--   next_touch_at date,可空
--   ball          text,可空

alter table producer.pursuits
  add column if not exists kind          text,
  add column if not exists ball          text,
  add column if not exists next_touch_at date;

-- 第二个洞:mail_label_audit。生产库的历史里有 `mail_label_audit`
-- (20260819043329,夹在 0081 和 0082 之间),同样没有文件。
-- 0082_the_ledger_answers_to_gmail 和 0112_scheduled_sends_get_audited 都要它。
--
-- 它记的是「这封信在 Gmail 那头现在挂着什么标签、还在不在」——
-- 账本对不对得上 Gmail,靠的是它。列和主键照生产库现状抄。
create table if not exists producer.mail_label_audit (
  gmail_message_id text primary key,
  labels           text[],
  gone             boolean     not null default false,
  checked_at       timestamptz not null default now()
);
