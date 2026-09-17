# 迁移顺序

## 2026-09-16 · 重号已改到位

合并主线那次一把改的（`git mv`，历史保住）：

| 原来 | 现在 |
|---|---|
| 祖先重号块十支（0111–0115 各 2–3 支） | 按下面那张表的「重编号后应是」 |
| 主线分叉后 0115–0127（14 支，含两支 0124） | 0121–0134（两支 0124 按提交日 9/4 → 9/5） |
| 本分支 0116–0122（7 支，只应用过 dev） | 0135–0141 |

`scripts/migration-order.mjs` 从此只剩「跳过数据修复」，顺序 = 文件名；再撞号会当场抛。

生产库 `supabase_migrations.schema_migrations` 里记的还是旧名——上 CLI（`db push` / `db reset`）之前要对一次账（见末尾「合并时要做的事」第 2 条）。

---

# 迁移的真实顺序（0111 起有重号）

2026-08-24 · 从生产库 `jjgvvtrsnoqnoigukobi` 的迁移历史读出来的

## 问题

0111–0115 各有 2–3 支同号。文件名排序 ≠ 实际应用顺序，而其中好几支是
`create or replace function` 覆盖同一个函数——**从零建库时按文件名跑，
结果取决于字典序,可能拿到旧版本的函数体**。

这是「一台干净机器从零跑通」的第一个拦路石（路线总纲 ② 的一部分）。

## 真实顺序（生产库时间戳为准）

| 应用时间 | 文件 | 重编号后应是 |
|---|---|---|
| 08-22 00:27 | `0111_the_pulse.sql` | 0111 ✅不动 |
| 08-22 00:49 | `0112_the_pulse_only_counts_real_changes.sql` | 0112 ✅不动 |
| 08-22 00:55 | `0113_a_second_workshop_to_offer.sql` | 0113 ✅不动 |
| 08-22 01:46 | `0113_rule_pass_only_writes_real_verdicts.sql` | **0114** |
| 08-22 01:48 | `0114_pulse_by_area.sql` | **0115** |
| 08-22 01:50 | `0115_the_board_stops_hauling_long_text.sql` | **0116** |
| 08-23 03:09 | `0111_needs_reply_is_not_shadowed.sql` | **0117** |
| 08-23 03:11 | `0112_scheduled_sends_get_audited.sql` | **0118** |
| 08-23 17:44 | `0113_retag_replays_in_order.sql` | **0119** |
| 08-23 18:10 | `0114_the_clock_follows_your_last_letter.sql` | **0120** |
| （未应用） | `0116_the_voice_is_data.sql` | 0121 |

## 为什么现在**不**改名

他还在个人分支（`batch-and-queue`）上继续加迁移。现在在这个分支上把十个
文件改名，合并时两边都动过文件名，是最难收的那种冲突；而且他新加的迁移
很可能又落在 0116+，改完再撞。

**改名安排在合并那一次做**，一把改到位。在那之前，从零建库按上表的顺序跑。

## 顺带

`0116_the_voice_is_data.sql`（语气那刀）原来错编成 0115，跟
`the_board_stops_hauling_long_text` 撞了——2026-08-24 已改成 0116。
它**没有应用到生产库**，所以改名零风险。

## 合并时要做的事

1. 按上表把十个文件改名（用 `git mv`，保住历史）
2. 生产库的 `supabase_migrations.schema_migrations` 里记的是旧名字。
   要上 Supabase CLI（`db push` / `db reset`，路线总纲 ③ 需要）之前，
   得把那张表跟文件名对一次账——一次性的 baseline 操作。
3. 之后新迁移一律单线递增，重号不再发生。
