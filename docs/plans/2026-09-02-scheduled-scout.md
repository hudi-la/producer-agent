# 周更找机会搬进 Fairwind · 施工计划

**稿子**：[docs/specs/2026-09-02-scheduled-scout-design.md](../specs/2026-09-02-scheduled-scout-design.md)——先读稿子。

**全局约束**（同以往）

- `producer` schema 不在 Exposed schemas 里：前端只读 `public.v_pa_*`、只写 `public` 的 security definer RPC；
  脑子同样走 RPC。`db.from('tasks')` 打的是 public 里不存在的表，回空不报错。
- 下一个迁移号 **0119**。
- 脑子改了行为 → `BRAIN_BUILD` 两边一起拨。
- 每一步 `npm test` 绿再往下。

---

## Task 1 · 库：任务能排期、脑子能建卡

文件：`supabase/migrations/0119_a_task_runs_on_a_schedule.sql`

- [ ] tasks 加列 `prompt / run_every / run_weekday / run_hour / next_run_at / running_since`，带 check
- [ ] `producer.task_next_run(every, weekday, hour, after)`：按 `producer.app_tz()` 算
- [ ] `pa_set_task` / `pa_run_task_now`（anon）；`pa_tasks_due` / `pa_task_start` / `pa_task_finish` /
      `pa_pursuit_titles` / `pa_create_pursuit`（service_role）
- [ ] `v_pa_tasks` 加列；`pulse_areas` 登记 `tasks`；`pulse_wire()`
- [ ] 用 MCP apply；`select producer.task_next_run('week',1,8,now())` 核一眼是下周一当地 08:00
- [ ] 真库：`聚合源 scout` 那行填 `prompt / run_every / run_weekday / run_hour`；插「每周找 Open Call」

## Task 2 · 脑子：纯函数

文件：`brain/scout.js` + `brain/scout.test.js`

- [ ] `tail({ today, tz, existing })`：脑子补的尾巴
- [ ] `parseCards(text)`：解析 `[[CARDS]]`，坏 JSON 返回 null
- [ ] `pick(cards, existing, cap)`：去重（标题 / 链接，忽略大小写）+ 星级排序 + 截断，返回 `{ take, dup, over }`
- [ ] `report({ today, made, dup, skipped, over })`：战报一行
- [ ] 测试：信封解析、去重、截断、战报含「查了没建卡」

## Task 3 · 脑子：跑起来

文件：`brain/server.js`

- [ ] `scoutPass()`：`pa_tasks_due` → 认领 → `think(prompt, READ_TOOLS, systemFor(profile), …, maxTurns 80)` →
      解析 → `pa_create_pursuit` 逐张 → `pa_task_finish`
- [ ] 挂 `setInterval(scoutPass, 30_000)`；不重入
- [ ] `/health` 带 `scout`
- [ ] `BRAIN_BUILD = '2026-09-02a'`，`src/lib/backends.js` 同步

## Task 4 · 前端：面板真的了

- [ ] `src/lib/tasks.js`：`scheduleText(t)`、`nextRunText(t)`、`setTask / runTaskNow` RPC；`tasks.test.js`
- [ ] `src/lib/pulse.js` AREAS 加 `tasks`
- [ ] `src/components/TasksPanel.jsx`：真开关、排期三选、提示词双击改（复用 `EditRow` 的 draft 机制）、
      现在跑一次、脑子没开那行；面板开着时订阅 `tasks` 脉搏重拉
- [ ] `src/data/schema.js` `TASK_DESC.scout_search`
- [ ] `src/styles.css`：展开区、select、按钮、warn 行

## Task 5 · 封面「新」

- [ ] `src/lib/batchTint.js`：`scout_` 前缀判据
- [ ] `src/components/Pipeline.jsx`：PCard 「新」圆标；Stack 头「N 张新」
- [ ] `src/App.jsx` `markSeen`：`unread || seen_at === null`
- [ ] 样式 `.pc-fresh`

## Task 6 · 血肉

- [ ] `src/demo/tasks.js`、`supabase/demo/0006_seed_tasks.sql` 带 prompt
- [ ] `demo/scout-prompt.md` 换新段；删 `demo/scout-sync-prompt.md`；`demo/README.md` 对应行
- [ ] `brain/README.md` 加一段「定时造卡」

## Task 7 · 验收

- [ ] `npm test` 全绿；`npm run build` 过
- [ ] 真库 `pa_run_task_now` 一条 → 脑子日志见到认领、建卡、战报；看板「新机会」多几张带「新」
- [ ] 点开一张，「新」灭；刷新还是灭的
- [ ] 提交
