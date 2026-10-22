# 聊天拨状态机 · 施工计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fairwind 在聊天里得出「提醒该改」的结论时，当场落成一条 decision 笔 + 标签，提醒栏跟着变；气泡底下一张小卡带【撤回】。

**Architecture:** 信封 `[[STATE]]`（跟 `[[LETTER]]` 同款，brain/tag.js 摘）→ brain 调一个 RPC 记笔+打标签+回写气泡 meta → `v_pa_state` 现算长出新提醒。撤回 = 另一个 RPC 软删笔、删标签、回写气泡 meta。转移表一格不改。

**Tech Stack:** Postgres（Supabase 迁移）、Node ESM（brain，node --test）、React（Vite）。

**Spec:** `docs/specs/2026-09-04-chat-moves-the-state-design.md`

## Global Constraints

- 下一个迁移号 **0123**（0122 已被「一串信里的一伙人」占了）。`producer` schema 不暴露；前端只读 `public.v_pa_*`、只写 `public` 的 SECURITY DEFINER RPC。
- 视图里不调 `producer.*` 函数（0101）；日期按 `producer.today_local()` 算，只在 RPC 里调。
- 白名单不动：`[[STATE]]` 是信封不是工具。
- 一封信已有的标签一个字不动；七种拨法全锚在新笔上。
- 测试：根目录 `npm test`（跑 src/lib + brain）。
- 提交信息中文，末尾带 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。

---

### Task 1 · 迁移 0122：写口、撤口、上下文带 state、followups 从新笔起算

**Files:** Create `supabase/migrations/0123_a_chat_moves_the_state.sql`

**Produces:**
- `public.pa_apply_state_move(p_kind text, p_subject uuid, p_move text, p_why text, p_line text, p_awaiting text, p_due date, p_meet_at timestamptz, p_needs_reply boolean, p_reply_why text, p_src_msg uuid) returns uuid`（笔的 id）
- `public.pa_undo_state_move(p_src_msg uuid) returns uuid`（撤掉的笔 id）
- `pa_brain_context` / `pa_brain_person_context` 多一键 `state`（`v_pa_state` 那一行或 null）
- `pa_rewind_chat` 连带软删 `meta.state_move.src_msg` 指向被删气泡的笔（并删其标签）
- `v_pa_state`：followups 只数 `m.created_at >= c.at` 的信（笔开的等待从 0 起算）
- `pa_selfcheck_state` 多一条：`situation like '聊天里定的%'` 的标签，笔的 meta 里都有 `state_move`

- [ ] Step 1：视图 —— 把 0118 的 `create or replace view public.v_pa_state … grant select` 整段复制，只改 followups 那一行：
  `greatest(0, count(m.id) filter (where m.created_at > coalesce(theirs.at, '-infinity') and m.created_at >= c.at)::int - 1) as n`
  文件头注明「除这一行外与 0118 一字不差」。
- [ ] Step 2：`pa_apply_state_move`。校验 move ∈ (resolved, wait, reschedule, park, needs_reply, meeting, done)；why 非空；wait/park/reschedule 要 p_due > today_local；meeting 要 p_meet_at；needs_reply 要 p_reply_why。插笔：`insert into producer.pursuit_messages (pursuit_id, contact_id, role, kind, content, meta)`，pursuit 时 pursuit_id、contact 时 contact_id，role='note'，kind='decision'，content = '聊天里定的：' || p_line，meta = `{"state_move":{move,why,src_msg}}`。打标签：`perform public.pa_tag_message(note_id, '聊天里定的：'||p_move, resolves, resolves_why, needs_reply, reply_why, awaiting, wait_days, meet_at, gist, 'fairwind-chat')`，按表：
  - resolved：resolves=true/why；needs_reply 透传
  - wait：resolves=true/why + awaiting + wait_days = p_due - today
  - reschedule：同 wait，awaiting = 现在 v_pa_state 那行的 what（读 `v_pa_state`，没有就报错「没有在等的事可改期」）
  - park：resolves=true + awaiting = '先放着：'||why + wait_days
  - needs_reply：needs_reply=true + reply_why
  - meeting：meet_at
  - done：resolves=true/why
  gist = p_line。回写气泡：`update producer.pursuit_messages set meta = jsonb_set(meta, '{state_move}', coalesce(meta->'state_move','{}') || jsonb_build_object('applied', true, 'note_id', note_id)) where id = p_src_msg`。grant service_role。
- [ ] Step 3：`pa_undo_state_move(p_src_msg)`：找 `kind='decision' and deleted_at is null and meta->'state_move'->>'src_msg' = p_src_msg::text` 的笔，没有就 raise '没有可撤的'；`delete from producer.message_tags where message_id = note`；笔 `deleted_at = now()`；气泡 meta.state_move.undone = true。grant anon, authenticated, service_role。
- [ ] Step 4：`pa_rewind_chat` 重写（照 0066 抄），多一段：先 `select array_agg(id)` 拿到将删的气泡 id，删完后对 `meta->'state_move'->>'src_msg' = any(ids::text[])` 的笔删标签 + 软删。
- [ ] Step 5：`pa_brain_context` / `pa_brain_person_context` 照 0066 整段抄，多一键 `'state', (select to_jsonb(s) from public.v_pa_state s where s.subject_kind='pursuit' and s.subject_id=p_pursuit_id limit 1)`（人版 'contact'）。
- [ ] Step 6：`pa_selfcheck_state` 照 0094 抄，末尾加一条检查。
- [ ] Step 7：`mcp supabase apply_migration` 应用；`select * from pa_selfcheck_state()` 全过；SQL 演练：挑一条 WAITING_REPLY 的线，`select pa_apply_state_move(...'wait'...)` → `v_pa_state` 变 → `pa_undo_state_move` → 长回原样（state/what/due_at 相同）。演练完撤回，不留痕。
- [ ] Step 8：提交 `聊天里定的事拨得动状态机：写口、撤口、上下文带 state（0122）`

### Task 2 · brain/stateMove.js：信封、规矩、小卡那行字

**Files:** Create `brain/stateMove.js`, `brain/stateMove.test.js`

**Produces:**
- `MOVES = ['resolved','wait','reschedule','park','needs_reply','meeting','done']`
- `extractStateMove(text, { today }) → { clean, move|null }`，move 形如 `{ move, why, awaiting?, due?, meet_at?, needs_reply?, reply_why? }`
- `moveLine(move) → string`（小卡第一行，也是笔的正文）
- `STATE_RULE`（静态块那段规矩）、`stateBlock(state) → string[]`（perLine 那段「提醒栏现在这样说」）

- [ ] Step 1：测试先红（node --test）：
  - `wait` 带 due 在明天之后 → move 齐全，clean 不含标记
  - `wait` 缺 due / due 是今天 / due 不是 YYYY-MM-DD → move=null，clean 原样
  - 缺 why → null
  - 不认识的 move → null
  - `resolved` 可带 needs_reply+reply_why；needs_reply 没 reply_why → 整个 needs_reply 丢、resolved 仍在
  - `needs_reply` 缺 reply_why → null；`meeting` 缺 meet_at → null
  - 信封坏了正文不丢（照 letter.test）
  - `moveLine`：`wait` → `等她接电话 · 到 9/12`；`reschedule` → `到点日改到 9/12`；`park` → `先放到 9/12`；`resolved` → `不用再等了`（+`，但这封要回`）；`needs_reply` → `这封要回`；`meeting` → `约了 9/11 见面`；`done` → `这件事不用管了`
  - `stateBlock(null)` 含「没有这条线的事」；`stateBlock({state:'WAITING_REPLY', what, due_at, zone:'stopped', followups:2})` 含 what、到点日、「连发 3 封」
- [ ] Step 2：实现，解析走 `takeTag(text,'STATE')`，成对规矩同 parseTag。
- [ ] Step 3：`npm test` 绿；提交。

### Task 3 · prompt：规矩进静态块，提醒进 perLine

**Files:** Modify `brain/prompt.js`（systemFor 加 STATE_RULE；ownerBlock 末尾加 stateBlock(ctx.state)）、`brain/prompt.test.js`（legacy 复刻同步加；新测试：pursuitCtx 带 state 时 perLine 含那段；不带时含「没有这条线的事」）、`brain/server.js` loadContext/loadPersonContext 传 `state: data.state || null`。

- [ ] Step 1：测试先红 → 实现 → `npm test` 绿 → 提交。

### Task 4 · server：聊天和到点两条路落地

**Files:** Modify `brain/server.js`（import；handleChat 摘信封 → addMessage(meta.state_move={...move, line}) → `applyStateMove(owner, move, bubbleId)` → 本地合并 applied/note_id 回 reply；timerPass 同样；`applyStateMove` 一个函数：调 `pa_apply_state_move`，失败只 console.warn 不挡）。

- [ ] Step 1：写 `applyStateMove`；两条路接上；信封摘的顺序：LETTER → FORM → STATE 串起来。
- [ ] Step 2：起 brain（他自己在终端起），在一条线上说「我觉得不用等了」看日志：`· 拨提醒：…`；`v_pa_state` 变。
- [ ] Step 3：提交。

### Task 5 · 前端：小卡 + 撤回

**Files:** Create `src/components/StateMoveCard.jsx`, `src/lib/stateMoves.js`（`undoStateMove(msgId)` → `supa.rpc('pa_undo_state_move', {p_src_msg})`）；Modify `src/components/PursuitFocus.jsx`（Message 里 LetterCard 旁）、`src/components/PersonFocus.jsx`、`src/styles.css`（`.scard` 复用 lcard 风格）。

小卡：
```
提醒改成了：等她接电话 · 到 9/12
凭什么：8/11 她回过「很想聊」…
[撤回]
```
只在 `meta.state_move.applied` 时画；`undone` → 灰字「撤回了 —— 提醒长回去了」，无按钮。撤回后调 onAdopted/reload 让往来和 state 重读。

- [ ] Step 1：写卡、接线、样式。
- [ ] Step 2：无头浏览器截图验收（headless-screenshots 那条记忆）。
- [ ] Step 3：提交。

### Task 6 · 文档

- [ ] brain/README「能」那一栏加「拨提醒（聊天里定的，你能撤回）」；设计稿 8/19 第十三节判断人表加一行 `fairwind-chat`；第十四节登记簿加一条。提交。
