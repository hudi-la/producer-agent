# 机会池 · 施工计划

**稿子**：[docs/specs/2026-09-03-opportunity-pool-design.md](../specs/2026-09-03-opportunity-pool-design.md)——先读稿子，
尤其第四节（够得着怎么判）和第五节（造卡是门槛不是名额）。

**全局约束**：`producer` 不在 Exposed schemas，前端只读 `v_pa_*`、只写 `public` 的 RPC；
下一个迁移号 **0120**；改了脑子行为就拨 `BRAIN_BUILD`（两边）；每步 `npm test` 绿再往下。

---

## Task 1 · 库：池子

`supabase/migrations/0120_a_pool_of_opportunities.sql`

- [ ] 建表 `producer.opportunities`（字段见稿子第八节）+ 标题唯一索引 + `updated_at` 触发器
- [ ] 脑子的口：`pa_upsert_opportunity` / `pa_opp_to_check` / `pa_opp_checked` /
      `pa_opp_reach` / `pa_opp_open_unpicked` / `pa_opp_note_round`
- [ ] 两边的口：`pa_pick_opportunity`（建卡走 `pa_create_pursuit`，回填 `pursuit_id`）
- [ ] 浏览器的口：`pa_drop_opportunity`
- [ ] `v_pa_opportunities` 读面；`pulse_areas` 加 `pool`；`pulse_wire()`；`v_pa_pulse` 加列
- [ ] MCP apply，核一眼优先级排序真的按稿子来

## Task 2 · 把 Excel 导进去（一次性）

`brain/import-xlsx.js` + `npm run import:xlsx`

- [ ] 读那 82 行（exceljs 已在 brain 依赖里），只读不写原文件
- [ ] 状态映射：🟢/⭐ → `open`；🟡 → `closed`；✅已投/🎉已录取 → 建行但立刻挂上已有的卡
- [ ] `★★★→3 / ★★→2`；Eligibility Hold 页 → `eligible=false`
- [ ] 去重：对 `producer.pursuits` 的标题/链接（对上就写 `pursuit_id`），对池子自己的标题
- [ ] 跑一次，报「导入 N 行，其中 M 行对上了看板上已有的卡」

## Task 3 · 脑子：三步

`brain/scout.js`（扩）+ `brain/reach.js`（新）+ 各自的 test

- [ ] `checkPrompt(rows, ctx)` / `parseChecks(text)` —— 复查一批，`[[CHECKS]]` 信封
- [ ] `reachPrompt(opp, ctx)` / `parseReach(text)` —— 够得着，`[[REACH]]` 信封，查不到必须报 unknown
- [ ] `pickable(rows)` —— 第五节那条门槛，纯函数好测
- [ ] `report3(...)` —— 三步战报
- [ ] `scoutPass` 改成三步；发现那一步落点改成 `pa_upsert_opportunity`
- [ ] reach 判断带上履历：用 `buildSystem` 那套（`entriesBlock` 在静态块里），不是光 `systemFor(profile)`

## Task 4 · 合并两条任务、手动那几条不再假装开着

- [ ] 库里：`scout_aggregators` 改名「每周找机会」，提示词并进两段来源；删 `scout_search` 那行（0 张卡）
- [ ] `src/demo/tasks.js`、`supabase/demo/0006`、`demo/*.md` 跟着改；`opencall-prompt.md` 并进 `scout-prompt.md`
- [ ] `TasksPanel` 分四组（定时跑的 / 跑过的专项 / 卡的出处 / 还没接）；后三组没有开关、不写「开着」

## Task 5 · 池子那张表

- [ ] `src/lib/loadPool.js` + `src/lib/pool.js`（排序、状态文案、reach 文案）+ test
- [ ] `src/components/Pool.jsx`（宽表 overlay；捡出来 / 别再提；已捡的灰掉不消失）
- [ ] 工具条入口「机会池 · N」；`pulse` 订阅 `pool`
- [ ] 样式

## Task 6 · 验收

- [ ] `npm test` 全绿、`npm run build` 过
- [ ] 手动跑一轮：复查有动静、池子进新行、reach 判出来带往届名单证据、够格的造了卡
- [ ] 截图给他看：池子表 + 面板四组
- [ ] 提交
