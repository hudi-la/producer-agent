# 你说一句，Fairwind 判该记成什么 · 施工计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** 聊天里说的话由 Fairwind 当场判成事件（[[STATE]]，带原话）、记忆（[[MEMO]]）或不记；记一笔按钮退场；见面复盘的双判去掉。

**Spec:** `docs/specs/2026-09-11-say-it-and-fairwind-files-it-design.md`

## Global Constraints

- 下一个迁移号 **0125**。producer schema 不暴露。视图里不调 producer 函数。
- **别碰 brain/judge.js**（另一个会话正在改它，工作区里有它未提交的改动）。server.js 只做定点替换。
- 一封信已有的标签一个字不动。测试：根目录 `npm test`。提交末尾带 Co-Authored-By。

### Task 1 · 迁移 0125
- [ ] `pa_apply_state_move`：drop 旧签名；加 `p_text text default null`；move 多 `met`（meet 笔 + resolves）；content = coalesce(nullif(btrim(p_text),''), '聊天里定的：'||line)
- [ ] `v_pa_state`（照 0124 抄）：meeting 那支的关法多认 `'聊天里定的：met%'` / `'聊天里定的：done%'`
- [ ] `pa_apply_memo` / `pa_undo_memo`；`pa_rewind_chat` 连带撤 memo
- [ ] 应用；selfcheck；SQL 演练带回滚；提交

### Task 2 · brain
- [ ] `stateMove.js`：MOVES + met；moveLine('met') = '见成了'；STATE_RULE 补 met 和「三个去处」；`extractMemo` / `MEMO_RULE` / `memoLine`；测试
- [ ] `prompt.js`：MEMO_RULE 进静态块；`server.js`：p_text 传原话（handleChat 用 mine.content）、删「见面复盘」那段、applyMemo、BRAIN_BUILD → 2026-09-11b（backends.js 同步）
- [ ] `npm test` 绿；提交

### Task 3 · 前端
- [ ] App 传 `brainUp` 给 PursuitFocus / PersonFocus
- [ ] 两张卡：删 jot 行和 howto；输入框 placeholder 按 brainUp；brainUp=false 时回车直接记 note 笔（线：addPursuitNote；人：people.js 加 logNote）
- [ ] `MemoCard.jsx`（复用 lcard 样式）+ `lib/stateMoves.js` 加 undoMemo；两张卡渲染 `meta.memo.applied`
- [ ] memo 笔的标签：线卡 ntag「记忆」，人卡「你记的一句」
- [ ] vite build；提交

### Task 4 · 文档
- [ ] brain/README「聊天拨得动提醒」那节扩成「你说一句，它判该记成什么」；8/19 稿子登记簿加一条
