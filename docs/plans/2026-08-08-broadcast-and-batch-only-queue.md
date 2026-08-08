# 第三刀实施计划：说一句… + 队列改批处理专用

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 勾一批卡，对它们说同一句话，各答各的，答完进队一张张读。同时把过卡队列收成**批处理专用**——删掉「行动时间到了」那套自动判据，入口从顶栏挪进工具条，出口只剩一个意思。

**Architecture:** 一道很小的迁移（`pa_add_message` 开 meta 参数）→ brain 的 `/chat` 透传 meta → 前端一个输入框 + 串行循环（跟 `runRefresh` 同构）→ 删死码 + 挪入口 + 改出口语义 + 抽屉补上活待办行。

**Tech Stack:** React 18 + Vite + `node:test`（零新依赖）。迁移走 Supabase MCP `apply_migration`。

**上游规格：** [docs/specs/2026-08-06-batch-and-queue-design.md](../specs/2026-08-06-batch-and-queue-design.md) —— §3.2「说一句…」、§2.4、§5.1、§5.3、§5.5（都带 2026-08-07/08 的改动标记）
**前两刀：** [第一刀](2026-08-06-filters-picking-and-queue.md) · [第二刀](2026-08-06-refresh-and-digest.md)（都已完成并真跑验收）

## Global Constraints

- **已有信息不许消失、不许不可见。** 删死码可以，删记录不行；挪 UI 可以，挪到看不见的地方不行。
- **不拼进正文。** 群发记号走 `meta`，绝不写进 `content`——那会当成你说的话进 prompt。
- **不新增 npm 依赖**；brain 的工具白名单一个不放宽。
- 中文注释，语气跟现有代码一致（说清楚**为什么**，不复述代码）。
- 文案固定：`说一句…`、`发给 N 条`、`说给第 3/6 条`、`过卡 · N`、`移出`、`再等一等`、`它提的`、`认了`。
- **钉住不许滚。** 凡是「告诉你现在什么情况」的东西（队头、出口、这次发生了什么、活待办行）一律待在 `.focus-top` 里。对话流上方那个位置会被 `endRef.scrollIntoView` 滚走——这坑踩过两次，不许第三次。
- **工作区带着大批在途改动**（08-05 三栏 + 0030 unread/profile 那批，十几个文件）。凡碰到这些文件的 commit，照前两刀的做法部分暂存（`git hash-object -w` + `git update-index --cacheinfo`），保证 commit diff 只含本任务、在途工作一行不丢不卷。工作区文件本身要改成「在途 + 本任务」的完整合并版。

---

### Task 1: 迁移 0031 —— `pa_add_message` 开 meta 参数

**Files:**
- Create: `supabase/migrations/0031_message_meta.sql`
- Apply via: Supabase MCP `apply_migration`（name: `message_meta`，project `jjgvvtrsnoqnoigukobi`）

**Interfaces:**
- Produces: `public.pa_add_message(p_pursuit_id uuid, p_role text, p_content text, p_kind text default 'message', p_meta jsonb default '{}')`（service_role），返回值形状不变

- [ ] **Step 1: 先看现状**

用 MCP `execute_sql` 把现在那个函数的定义抄出来，照着改，别凭记忆重写：

```sql
select pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'pa_add_message';
```

- [ ] **Step 2: 写迁移**

创建 `supabase/migrations/0031_message_meta.sql`。**函数体照抄上一步查出来的原文，只在末尾多写一列 meta**：

```sql
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
as $$
-- ⚠️ 这里照抄 Step 1 查出来的原函数体，只把 insert 的列表和 values 各加一项 meta。
-- 别自己重写：原来那段有它自己的校验和返回形状，重写一遍就是引入一个看不见的差异。
$$;

revoke all on function public.pa_add_message(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.pa_add_message(uuid, text, text, text, jsonb) to service_role;
```

- [ ] **Step 3: 应用 + 验证**

`apply_migration` 之后用 `execute_sql` 验三条：

```sql
-- 1. 旧的 4 参版本没了（返回 1 行，就是新的 5 参）
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='pa_add_message';
-- 2. 不传 meta 照样能写（brain 现有调用全是 4 参，必须不受影响）
--    ——拿一条测试线写一条，看返回，然后删掉这一行
-- 3. 传了 meta 能存进去
```

**第 2 条验完必须把测试消息删掉**，`delete from producer.pursuit_messages where id = '<刚插的>'`。改前改后 `pursuit_messages` 行数必须一样——记下两个数字。

- [ ] **Step 4: 提交**

```bash
git add supabase/migrations/0031_message_meta.sql
git commit -m "0031：pa_add_message 开 meta 参数

群发那句要标明它是群发的。列早就有，只是口子上没开。
不拼进正文 —— 那会当成你说的话进 prompt。"
```

---

### Task 2: brain `/chat` 透传 meta

**Files:**
- Modify: `brain/server.js`（`addMessage` + `handleChat`）
- Modify: `src/lib/backends.js`（`BRAIN_BUILD` 升号）

**Interfaces:**
- Consumes: Task 1 的 5 参 `pa_add_message`
- Produces: `POST /chat {pursuit_id, text, meta?}` —— `meta` 只贴在**你那条** artist 消息上，Fairwind 的回复不带

- [ ] **Step 1: addMessage 收 meta**

`brain/server.js` 里 `addMessage` 加第四个参数：

```js
async function addMessage(pursuitId, role, content, kind = 'message', meta = null) {
  const { data, error } = await db.rpc('pa_add_message', {
    p_pursuit_id: pursuitId, p_role: role, p_content: content, p_kind: kind,
    ...(meta ? { p_meta: meta } : {}),
  })
  if (error) throw new Error(`存${role === 'artist' ? '你的话' : 'Fairwind 的回复'}失败：` + error.message)
  return data
}
```

`...(meta ? …)`：不传就完全不带这个键，走函数默认值——现有那十几处 4 参调用一个都不用改。

- [ ] **Step 2: handleChat 透传**

```js
async function handleChat(body) {
  const { pursuit_id, text, meta } = body
  if (!pursuit_id || !text?.trim()) throw new Error('要有 pursuit_id 和 text')

  // 先落库：哪怕后面想崩了，你说的话也不会丢。
  // meta 只贴在**你这条**上——它记的是「你这句是怎么发出来的」（群发/单发），
  // 不是这条线的属性，更不是 Fairwind 回复的属性。
  const mine = await addMessage(pursuit_id, 'artist', text.trim(), 'message', meta || null)
  …（其余不动）
```

- [ ] **Step 3: 两边 BRAIN_BUILD 一起升号**

`brain/server.js` 和 `src/lib/backends.js` 里的 `BRAIN_BUILD`，`'2026-08-06e'` → `'2026-08-08a'`。**不升的话 Trouble 会误报「脑子版本旧」**，升错一边同样误报。

- [ ] **Step 4: 验证**

```bash
node --check brain/server.js
```

端口 8788 上如果 brain 正跑着（`lsof -i :8788`），那是用户终端里的——**不要杀、不要抢**。改为静态核对：`addMessage` 的每一处调用点参数个数、`db.rpc` 的参数名对得上 0031 的实签。活冒烟留给 Task 6。

- [ ] **Step 5: 提交**（两个文件都有在途改动，部分暂存）

```bash
git commit -m "brain /chat 透传 meta

meta 只贴在你那条 artist 消息上 —— 它记的是「你这句怎么发出来的」，
不是这条线的属性，也不是 Fairwind 回复的属性。
不传就走函数默认值，现有十几处 4 参调用一处都不用改。"
```

---

### Task 3: 「说一句…」—— 输入框 + 串行群发

**Files:**
- Create: `src/components/SayTo.jsx`
- Modify: `src/lib/chat.js`（`sendMessage` 收 meta）
- Modify: `src/components/Subbar.jsx`
- Modify: `src/App.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 2 的 `/chat` meta、`enqueue`（queue.js）
- Produces:
  - `sendMessage(pursuitId, text, meta?)`
  - `<SayTo n={number} onSend={(text)=>void} onCancel={()=>void} />`
  - `<Subbar>` 新 props：`onSay`、`saying: {i,n} | null`
  - 队列项 `via: 'say'`

- [ ] **Step 1: chat.js 收 meta**

```js
export async function sendMessage(pursuitId, text, meta) {
  …
      body: JSON.stringify({ pursuit_id: pursuitId, text, ...(meta ? { meta } : {}) }),
  …
}
```

其余一字不动。现有单发调用（PursuitFocus 的 `send()`）不传第三个参数，行为完全不变。

- [ ] **Step 2: SayTo 组件**

创建 `src/components/SayTo.jsx`：

```jsx
import React, { useState } from 'react'

// 对选中的 N 条线说同一句话。
//
// 为什么是一个输入框而不是几个预设按钮：**预测不了你想批量干什么**。
// 「起草邮件」只是今天想得到的一种，明天你可能想让 15 条线各自去查一下
// 对方最近有没有新动向。指令是开放的，按钮是封闭的。
export default function SayTo({ n, onSend, onCancel }) {
  const [text, setText] = useState('')
  const t = text.trim()

  return (
    <>
      <div className="ov-scrim on" onClick={onCancel} aria-hidden="true" />
      <div className="sayto" role="dialog" aria-label={`对选中的 ${n} 条线说一句`}>
        <h3 className="sayto-t">对选中的 {n} 条线说一句</h3>
        {/* 说清楚它会怎么落地——这句话会写进每条线的对话，是不可撤销的记录 */}
        <p className="sayto-s">同一句话分别说给每条线，各答各的（它们的料不一样）。这句会记进每条线的对话，标明是群发。</p>
        <textarea
          className="sayto-in"
          value={text}
          autoFocus
          rows={4}
          placeholder="帮我起一封信问问工作坊的具体日程和场地……"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
            // Enter 换行，⌘/Ctrl+Enter 发出去 —— 这是多行输入，回车不该是提交
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && t) { e.preventDefault(); onSend(t) }
          }}
        />
        <div className="sayto-btns">
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="wbtn" disabled={!t} onClick={() => onSend(t)}>发给 {n} 条</button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Subbar 加按钮和进度**

选择模式那组，「过一遍」**前面**加「说一句…」（它是主动作）：

```jsx
        <>
          <button className="wbtn" disabled={!pickedCount || Boolean(saying)} onClick={onSay}>说一句…</button>
          <button className="wbtn" disabled={!pickedCount} onClick={onPickAll}>过一遍</button>
          <button className="btn" onClick={onCancelPick}>取消</button>
        </>
```

进度贴在 `.refreshing` 旁边（同一种东西：系统在报，不能点）：

```jsx
      {saying && (
        <span className="refreshing"><i className="spin" aria-hidden="true" />说给第 {saying.i}/{saying.n} 条</span>
      )}
```

props 加 `onSay, saying`。

- [ ] **Step 4: App 的循环**

状态和循环放 `runRefresh` 旁边（同构，照它写）：

```js
  const [sayOpen, setSayOpen] = useState(false)
  const [saying, setSaying] = useState(null)        // {i, n} | null
  const [sayFailed, setSayFailed] = useState(0)

  // 群发：同一句话分别说给每条线，各答各的。
  //
  // 串行，一条十几秒——跟 runRefresh 一个节奏。答完的当场进队，先到先过。
  // 批次标识用一个时间戳串：同一批的每条消息带同一个 batch，将来要认出
  // 「这几条是一次群发」也认得出来。
  const runSay = async (text) => {
    if (saying) return
    const ids = [...picked]
    if (!ids.length) return
    setSayOpen(false)
    cancelPick()
    setSayFailed(0)
    const batch = new Date().toISOString()
    const meta = { broadcast: { batch, count: ids.length } }
    let failed = 0
    for (let i = 0; i < ids.length; i++) {
      setSaying({ i: i + 1, n: ids.length })
      try {
        await sendMessage(ids[i], text, meta)
        setQueue((q) => enqueue(q, [{ id: ids[i], via: 'say' }]))
      } catch (_) {
        failed++
      }
    }
    setSaying(null)
    setSayFailed(failed)
    const r = await loadPursuits()
    if (r) setPl(r)
  }
```

`sendMessage` 从 `./lib/chat.js` 里 import（那行已有别的导入，加进去）。

Subbar 传 `onSay={() => setSayOpen(true)} saying={saying}`；`<SayTo>` 在 `sayOpen && picked.size > 0` 时渲染（跟 TasksPanel 同一层）：

```jsx
      {sayOpen && picked.size > 0 && (
        <SayTo n={picked.size} onSend={runSay} onCancel={() => setSayOpen(false)} />
      )}
```

Trouble 那条复用 Task 3 已有的失败行——改成同时认 `refreshFailed` 和 `sayFailed`：把 Trouble 的 prop 改成 `batchFailed`，App 传 `refreshFailed + sayFailed`，文案「有 N 条线这轮没跑成」。

- [ ] **Step 5: 群发那句在对话里认得出来**

`src/components/PursuitFocus.jsx` 的 `Message`：`m.meta?.broadcast` 时，那条气泡上加一行极轻的说明：

```jsx
  const bc = m.meta?.broadcast
  …
      <span className="who">{who}{m.kind === 'email' && <span className="viamail"> · 邮件</span>}
        {bc && <span className="viamail"> · 同时发给了 {bc.count} 条线</span>}
      </span>
```

**这条是这一刀的要害**：不标的话，半年后你翻回某条线，看见自己说「帮我起一封信问问日程」，会以为当时专门为这家想过。

- [ ] **Step 6: 样式**

```css
/* 对选中的 N 条线说一句。居中一块地方，不是抽屉——它不属于任何一条线。 */
.sayto { position: fixed; z-index: 40; left: 50%; top: 22vh; transform: translateX(-50%);
  width: min(520px, calc(100vw - 40px)); background: var(--paper-2); border: 1px solid var(--line-2);
  border-radius: 14px; box-shadow: var(--shadow); padding: 18px 20px 16px;
  display: flex; flex-direction: column; gap: 10px; }
.sayto-t { font-family: var(--serif); font-size: 16px; font-weight: 600; margin: 0; }
.sayto-s { font-size: 12px; color: var(--ink-3); line-height: 1.6; margin: 0; }
.sayto-in { font: inherit; font-size: 13.5px; line-height: 1.6; resize: vertical;
  padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line-2);
  background: var(--paper); color: var(--ink); }
.sayto-in:focus { outline: none; border-color: var(--accent); }
.sayto-btns { display: flex; justify-content: flex-end; gap: 9px; }
```

- [ ] **Step 7: 验证 + 提交**

`npm test` + `npm run build` 必须过。浏览器验证清单留给我（brain 要真跑才验得了群发，那是 Task 6）。有在途改动的文件部分暂存。

```bash
git commit -m "说一句…：勾一批，说同一句，各答各的

预测不了你想批量干什么 —— 指令是开放的，按钮是封闭的。
复用现成的 /chat，每条线本来就带着自己的全部上下文。
群发那句在对话里标明是群发：不标的话半年后你以为自己专门为那家想过。"
```

---

### Task 4: 队列收成批处理专用 —— 删死码 + 挪入口

**Files:**
- Modify: `src/lib/filters.js`（删 `dueNow` / `dueReason`）
- Modify: `src/lib/filters.test.js`（删对应 7 个测试）
- Modify: `src/App.jsx`（删 `enqueueDue` / 开页面扫描 / `dueScannedRef` / `dueWhy`；顶栏按钮挪走）
- Modify: `src/components/Subbar.jsx`（收下「过卡 · N」）
- Modify: `src/components/PursuitFocus.jsx`（删 `dueWhy` 那块）
- Modify: `src/styles.css`（`.qbtn` 适配工具条）

**Interfaces:**
- Produces: `<Subbar>` 新 props：`queueCount: number`、`onOpenQueue: () => void`

- [ ] **Step 1: 删死码**

按这个清单删干净——**留着不用的机关，迟早有人以为它在跑**：

| 删什么 | 在哪 |
|---|---|
| `dueNow` / `dueReason` 两个函数 | `src/lib/filters.js` |
| `MD` 的 import（删完没人用了就删） | `src/lib/filters.js` |
| `dueNow` / `dueReason` 的 7 个测试 | `src/lib/filters.test.js` |
| `enqueueDue` 函数 | `src/App.jsx` |
| 开页面那次 `enqueueDue(pl.pursuits)` + `dueScannedRef` | `src/App.jsx` |
| `runRefresh` 末尾的 `enqueueDue(r.pursuits)`（`setPl(r)` 留着） | `src/App.jsx` |
| `qInfo` 里的 `dueWhy` 字段 + `dueReason` 的 import | `src/App.jsx` |
| `{queue?.dueWhy && …}` 那块 | `src/components/PursuitFocus.jsx` |

`src/lib/nextAction.js` 里 `MD` 的 `export` **留着**——导出一个自己也在用的小工具没成本，而且 Task 5 的活待办行会用到它。

删完 `npm test` 应该是 26 个（33 − 7），全绿。

- [ ] **Step 2: 入口挪进工具条**

`App.jsx` 顶栏里那段整块删掉：

```jsx
        {queue.items.length > 0 && (
          <button className="qbtn" onClick={() => openQueueCard(queue.at)}>
            <span className="qpile" aria-hidden="true" />过卡 · {queue.items.length}
          </button>
        )}
```

`Subbar` 收下，放在非选择模式那组、「批量操作」和「造卡任务」**中间**：

```jsx
        <>
          <button className="wbtn" disabled={Boolean(refreshing)} onClick={onRefresh}>更新最新信息</button>
          <button className="wbtn" onClick={onStartPick}>批量操作</button>
          {/* 队空的时候整个按钮不渲染。不显示「过卡 · 0」——占位就是骗人 */}
          {queueCount > 0 && (
            <button className="qbtn" onClick={onOpenQueue}>
              <span className="qpile" aria-hidden="true" />过卡 · {queueCount}
            </button>
          )}
          <button className="wbtn" onClick={onOpenTasks}>造卡任务</button>
        </>
```

App 传 `queueCount={queue.items.length} onOpenQueue={() => openQueueCard(queue.at)}`。

`.qbtn` 的字号/内边距对齐 `.wbtn`（12.5px / 6px 13px），它现在跟一排 `.wbtn` 站一起，长得不一样会显得是另一种东西。

- [ ] **Step 3: 验证 + 提交**

`npm test`（26 绿）+ `npm run build`。浏览器：顶栏干净了、工具条上「过卡 · N」在「批量操作」和「造卡任务」中间、点它开抽屉、**切到「人际管理」它跟着整条工具条消失**（那是对的，批处理只在项目争取有）。

```bash
git commit -m "队列收成批处理专用：删掉自动判据，入口挪进工具条

「行动时间到了」那套是昨天加的，今天拆 —— 左边两个开关已经在做同一件事，
多一套后台判据只是把它做两遍，而且只知道它碰巧注意到的那些。

入口跟着挪：顶栏常驻角标本身就是「你有一摊持续欠着的事」那句主张，
队列不再是那个东西。谁生的跟谁站。"
```

---

### Task 5: 出口改名 + 认领剥离 + 抽屉显示活待办

**Files:**
- Modify: `src/components/PursuitFocus.jsx`
- Modify: `src/App.jsx`（`finishCard` 瘦身）
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `actionLine(p)`（带 `by`）、`acceptNextAction`（chat.js，第二刀已有）
- Produces: `<PursuitFocus>` 新 prop：`onAccept: (pursuitId) => void`

- [ ] **Step 1: 出口改名 + `finishCard` 瘦身**

`PursuitFocus` 队头那个按钮 `做完了` → `移出`。

`App.jsx` 的 `finishCard` 砍成只剩出队——**把认领整段删掉**：

```js
  // 移出：从这一摞里拿走。**就这一个意思。**
  //
  // 原来它还偷偷替你认领 Fairwind 提的下一步（next_action_by → you）。
  // 那是让队列去替卡里的事实说话：「队列里有没有它」和「这件事做没做完」是两回事，
  // 一个按钮断言两件事，就有一件迟早是假的。认领搬到那句提案自己旁边去了。
  const finishCard = () => {
    const q = queueDone(queue, view.pursuit.id)
    setQueue(q)
    if (!q.items.length) closePursuit()
    else openQueueCard(q.at)
  }
```

- [ ] **Step 2: 抽屉显示活着的待办 + 「认了」**

**抽屉现在根本不显示当前待办**——只显示做完的（`done`）和作废的（`voided`）。补上，认领才有地方挂。

`PursuitFocus` 里算出来：

```js
  const live = actionLine(p)                              // 现在该干什么（已经跳过作废的）
  const proposed = live?.by === 'fairwind' ? live : null  // 它提的、你还没认的
```

渲染在 `.focus-top` 里、`.qwhat` 后面（**必须钉住，不能进对话流**——那儿会被滚走）：

```jsx
        {live && (
          <div className={'pf-live' + (live.urgent ? ' urgent' : '')}>
            <span className="pf-live-t">{live.text}</span>
            {proposed && (
              <>
                <span className="pc-by">它提的</span>
                <button className="lnk" onClick={() => onAccept?.(p.id)}>认了</button>
              </>
            )}
          </div>
        )}
```

App 传 `onAccept`：

```js
  // 你认了它提的那句：记号消失。这是对**那句话**表态，
  // 跟「这张卡还在不在我手头」无关——所以它不在过卡器的出口上。
  const acceptProposal = async (id) => {
    setPl((cur) => cur && ({ ...cur, pursuits: cur.pursuits.map((x) => (x.id === id ? { ...x, next_action_by: 'you' } : x)) }))
    try { await acceptNextAction(id) } catch (e) { alert('没认上：' + e.message) }
  }
```

（`acceptNextAction` 第二刀就在 chat.js 里，App 现在还 import 着——原来给 `finishCard` 用的，现在改给这儿用。）

- [ ] **Step 3: 样式**

```css
/* 抽屉里那条活着的待办。原来只显示做完的和作废的 —— 唯独没显示「现在该干什么」。 */
.pf-live { display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  font-size: 12.5px; color: var(--ink); }
.pf-live.urgent .pf-live-t { color: var(--accent); font-weight: 600; }
```

- [ ] **Step 4: 验证 + 提交**

`npm test`（26 绿）+ build。浏览器：
1. 抽屉队头那个按钮写着「移出」
2. 抽屉里看得见当前待办；Fairwind 提的那条带「它提的」+「认了」
3. 点「认了」→ 记号当场消失；看板那张卡上的「它提的」也消失（8 秒轮询后或立刻，看乐观更新）
4. 点「移出」→ 只是出队，**卡上「它提的」记号还在**（这是这一刀的证据：出口不再替你认领）

```bash
git commit -m "移出只剩一个意思；认领搬到那句提案旁边

「做完了」原来同时断言「拿走」和「干完了」，还偷偷改 next_action_by。
一个按钮断言两件事，就有一件迟早是假的。

顺带补上：抽屉原来只显示做完的和作废的待办，唯独不显示「现在该干什么」。"
```

---

### Task 6: 真跑一次（要你在场）

不是代码任务。brain 和 Gmail 连接器只在用户机器上活着。

- [ ] brain 重启（拿到 `/chat` 的 meta 透传）：`Ctrl+C` 然后 `npm run brain`；`curl -s localhost:8788/health` 应返回 `2026-08-08a`
- [ ] 勾 2–3 张**冷外联**的卡（那批 workshop 机构），「说一句…」写一句真话，发出去
- [ ] 看：进度走完 → 工具条冒出「过卡 · N」→ 点开一张张读
- [ ] 每条线的对话里，**你那句带着「· 同时发给了 3 条线」**
- [ ] 三条回答**确实不一样**（料不同）——一样的话说明上下文没进去，那是 bug
- [ ] 「移出」一张 → 出队，卡上「它提的」记号还在；「认了」一下 → 记号消失
- [ ] 刷新页面 → 剩下的还在队里；切到「人际管理」→ 工具条整条消失（含过卡）

---

## 顺序与依赖

1 → 2 → 3 严格串行（2 靠 1 的 RPC，3 靠 2 的口）。**4 和 5 不依赖 1–3**，可以先做也可以后做；建议按序做完再一起验。6 靠全部。

## 明确不做（这一刀）

- **从对话里长出产出**（08-05 ⬜）。「说一句…」跑出来的是对话回复，改不了也定不了稿——那是 08-05 欠的债，该跟右栏那套一起还。
- **群发指令存成模板。** 等你真的重复打过三次同一句再说。
- **并发跑。** 先串行，跟 `runRefresh` 一个节奏。
- **群发给「说一句…」单独的失败重试。** 失败计数进 Trouble，重跑就是再勾一次——这一刀不做断点续传。
