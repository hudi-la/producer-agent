# 第一刀实施计划：两个筛选开关 + 选择模式 + 过卡队列

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工具条上四个死 tab 换成两个真能筛的开关，加上一个「勾一批卡端进过卡队列、一张张过完」的闭环。

**Architecture:** 两个纯逻辑模块（`filters.js` 决定哪张卡看得见，`queue.js` 是一份存在 localStorage 的待办）+ 三处界面接线（工具条抽成 `Subbar.jsx`、`Pipeline` 加勾选、抽屉加队头和两个出口）。App.jsx 只做状态编排。**不碰数据库、不碰 brain、零迁移。**

**Tech Stack:** React 18 + Vite。测试用 Node 内置的 `node:test` + `node:assert/strict`——**不新增任何依赖**（这个项目只有 6 个运行时依赖、2 个开发依赖，为了给两个纯函数模块写测试而装 vitest 不划算）。React 组件不写自动化测试，靠浏览器验。

**上游规格：** [docs/specs/2026-08-06-batch-and-queue-design.md](../specs/2026-08-06-batch-and-queue-design.md)（第一刀 = §六 表里那一行）

## Global Constraints

- **已有信息不许消失、不许不可见。** 这条压过一切。切镜头不清空勾选、翻页不改任何东西、「再等一等」不把卡拿走——都是这条的推论。
- **不显示「过卡 · 0」。** 队空的时候整个按钮不渲染。这一刀刚撤掉四个占位按钮，不许再长一个出来。
- **顶栏那个数字只降在你按「做完了」的时候。** 翻页（`›`）不降，「再等一等」不降。
- **不新增 npm 依赖。**
- **不碰数据库、不碰 `brain/`、不加迁移。**
- 中文注释，语气跟现有代码一致（说清楚**为什么**这么定，不是复述代码在干嘛）。
- 文案用词固定：`待处理`、`紧急`、`批量操作`、`过一遍`、`取消`、`做完了`、`再等一等`、`过卡`、`造卡任务`。
- **工具条上这一刀不放「更新最新信息」。** 它是第二刀。放一个还不能用的按钮，就是刚撤掉的那个病。

---

### Task 1: `filters.js` —— 两个开关的判定

**Files:**
- Create: `src/lib/filters.js`
- Create: `src/lib/filters.test.js`
- Modify: `package.json`（加 `test` 脚本）

**Interfaces:**
- Consumes: [`ballOf(p)`](../../src/lib/ball.js)（返回 `'me' | 'them' | null`）、[`deadlineLine(p)`](../../src/lib/nextAction.js#L39-L47)（返回 `{text, urgent, over?} | null`）
- Produces:
  - `FILTERS: [string, string][]` —— `[['mine','待处理'], ['urgent','紧急']]`
  - `NO_FILTERS: {mine: false, urgent: false}`
  - `anyOn(on): boolean`
  - `matches(p, on): boolean`
  - `applyFilters(pursuits, on): Pursuit[]`

- [ ] **Step 1: 加测试脚本**

改 `package.json` 的 `scripts`，在 `"dev"` 那行后面加一行：

```json
  "scripts": {
    "dev": "vite",
    "test": "node --test 'src/lib/*.test.js'",
    "brain": "npm start --prefix brain",
    "build": "vite build",
    "preview": "vite preview"
  },
```

引号必须留着——glob 要交给 Node 自己展开，交给 shell 会在没有匹配时报错。

- [ ] **Step 2: 写会失败的测试**

创建 `src/lib/filters.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FILTERS, NO_FILTERS, anyOn, matches, applyFilters } from './filters.js'

/** 距今 n 天的那一天，'YYYY-MM-DD'。测试不能写死日期——写死了明天就红。 */
const day = (n) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const soon = { id: 'soon', ball_eff: 'them', deadline_at: day(3) }
const far = { id: 'far', ball_eff: 'them', deadline_at: day(60) }
const mineSoon = { id: 'ms', ball_eff: 'me', deadline_at: day(3) }
const mineFar = { id: 'mf', ball_eff: 'me', deadline_at: day(60) }
const over = { id: 'over', ball_eff: 'them', deadline_at: day(-5) }
const nothing = { id: 'none' }   // 没球权、没截止

const all = [soon, far, mineSoon, mineFar, over, nothing]

test('两个开关的顺序和文案固定', () => {
  assert.deepEqual(FILTERS, [['mine', '待处理'], ['urgent', '紧急']])
})

test('都不按 = 全部，一张不筛', () => {
  assert.equal(anyOn(NO_FILTERS), false)
  assert.equal(applyFilters(all, NO_FILTERS).length, all.length)
})

test('待处理：只留球在我这边的。没有依据的（null）也筛掉', () => {
  const got = applyFilters(all, { mine: true, urgent: false }).map((p) => p.id)
  assert.deepEqual(got, ['ms', 'mf'])
})

test('紧急：14 天内和已过的都算，球不在我这边的也算', () => {
  const got = applyFilters(all, { mine: false, urgent: true }).map((p) => p.id)
  assert.deepEqual(got, ['soon', 'ms', 'over'])
})

test('两个都按 = 交叉，这才是最该现在动的那批', () => {
  const got = applyFilters(all, { mine: true, urgent: true }).map((p) => p.id)
  assert.deepEqual(got, ['ms'])
})

test('没有截止的线不算紧急 —— 不猜', () => {
  assert.equal(matches(nothing, { mine: false, urgent: true }), false)
})

test('deadline 只有原文、没有可算的日期，也不算紧急', () => {
  const vague = { id: 'v', deadline: 'spring 2027' }
  assert.equal(matches(vague, { mine: false, urgent: true }), false)
})
```

- [ ] **Step 3: 跑测试，确认它失败**

Run: `npm test`
Expected: FAIL，报 `Cannot find module '.../src/lib/filters.js'`

- [ ] **Step 4: 写实现**

创建 `src/lib/filters.js`：

```js
// 看板的两个开关。它们说的是「看**哪些**」，不是「怎么排」。
//
// 原来那四个 tab（按阶段/按截止/按作品/按来源）说的都是「怎么排」，
// 而看板已经按阶段排了——排法只能有一种，所以那四个天生互相打架，
// 接哪一个都要把七列拆掉重画。这就是它们两天都接不上的原因。
//
// 这两个不冲突：七列照旧，只是变稀。而且它们可以**同时按下去**——
// 真正有用的恰恰是交叉（球在我这边、而且快到期）。
import { ballOf } from './ball.js'
import { deadlineLine } from './nextAction.js'

/** 界面上摆出来的两个开关，顺序固定。 */
export const FILTERS = [
  ['mine', '待处理'],
  ['urgent', '紧急'],
]

/** 都不按 = 全部。所以没有「全部」那个按钮——它就是"什么都不按"，单列一个反而多余。 */
export const NO_FILTERS = { mine: false, urgent: false }

export function anyOn(on) {
  return Boolean(on?.mine || on?.urgent)
}

/** 这张卡在当前镜头里看得见吗。 */
export function matches(p, on) {
  // 球在谁那边：null = 还没有依据（0017：宁可不说，也不猜）。没有依据就不算待处理。
  if (on?.mine && ballOf(p) !== 'me') return false
  // 紧急 = deadlineLine 自己判的那个 urgent（14 天内 / 已过）。
  // 不在这儿重算门槛——两处算同一件事，早晚会说的不是一句话。
  if (on?.urgent && !deadlineLine(p)?.urgent) return false
  return true
}

export function applyFilters(pursuits, on) {
  if (!anyOn(on)) return pursuits
  return pursuits.filter((p) => matches(p, on))
}
```

- [ ] **Step 5: 跑测试，确认全绿**

Run: `npm test`
Expected: PASS，7 个测试全过

- [ ] **Step 6: 提交**

```bash
git add package.json src/lib/filters.js src/lib/filters.test.js
git commit -m "两个筛选开关的判定 + 一个不用装东西的测试底子"
```

---

### Task 2: `queue.js` —— 手头这摊活

**Files:**
- Create: `src/lib/queue.js`
- Create: `src/lib/queue.test.js`

**Interfaces:**
- Consumes: 无（纯函数 + `localStorage`）
- Produces:
  - `EMPTY: {items: [], at: null}`
  - `loadQueue(): QueueState` / `saveQueue(q): void` / `normalize(raw): QueueState`
  - `enqueue(q, entries): QueueState` —— `entries: [{id, via?}]`
  - `done(q, id): QueueState` / `later(q, id, on?): QueueState`
  - `goto(q, delta): QueueState` / `indexOf(q): number`
  - `allSkipped(q): boolean` / `inQueue(q, id): boolean`
  - 队列项形状：`{ id: string, via: string, skipped: boolean, skippedAt: string|null }`

- [ ] **Step 1: 写会失败的测试**

创建 `src/lib/queue.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY, normalize, loadQueue, saveQueue,
  enqueue, done, later, goto, indexOf, allSkipped, inQueue,
} from './queue.js'

const q3 = () => enqueue(EMPTY, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])
const ids = (q) => q.items.map((x) => x.id)

test('塞三张，光标落在第一张', () => {
  const q = q3()
  assert.deepEqual(ids(q), ['a', 'b', 'c'])
  assert.equal(q.at, 'a')
  assert.equal(indexOf(q), 0)
})

test('不重复塞 —— 同一张塞两次还是一张，位置不动，via 更新', () => {
  const q = enqueue(q3(), [{ id: 'a', via: 'mail' }])
  assert.deepEqual(ids(q), ['a', 'b', 'c'])
  assert.equal(q.items[0].via, 'mail')
})

test('再塞一张放过的，「先放着」清零 —— 它变了，值得你再看一眼', () => {
  const q = enqueue(later(q3(), 'a'), [{ id: 'a', via: 'mail' }])
  assert.equal(q.items.find((x) => x.id === 'a').skipped, false)
  assert.equal(q.items.find((x) => x.id === 'a').skippedAt, null)
})

test('做完了：拿走，光标落到原位置上的下一张', () => {
  const q = done(q3(), 'a')
  assert.deepEqual(ids(q), ['b', 'c'])
  assert.equal(q.at, 'b')
})

test('做完最后一张，光标退回上一张', () => {
  let q = q3()
  q = goto(q, 2)
  q = done(q, 'c')
  assert.deepEqual(ids(q), ['a', 'b'])
  assert.equal(q.at, 'b')
})

test('做完唯一一张 —— 队空了', () => {
  const q = done(enqueue(EMPTY, [{ id: 'a' }]), 'a')
  assert.deepEqual(q, EMPTY)
})

test('再等一等：留着，挪队尾，数字不降', () => {
  const q = later(q3(), 'a', '2026-08-06')
  assert.deepEqual(ids(q), ['b', 'c', 'a'])
  assert.equal(q.items.length, 3)
  assert.equal(q.items[2].skipped, true)
  assert.equal(q.items[2].skippedAt, '2026-08-06')
  assert.equal(q.at, 'b')
})

test('全放过了 —— 抽屉该停手，不无限转圈', () => {
  let q = q3()
  q = later(q, 'a'); q = later(q, 'b'); q = later(q, 'c')
  assert.equal(allSkipped(q), true)
  assert.equal(q.items.length, 3)
})

test('空队不算「全放过了」—— 没有"剩下的"', () => {
  assert.equal(allSkipped(EMPTY), false)
})

test('翻页什么都不改，只移动光标；到头就停住', () => {
  const q = q3()
  const a = goto(q, 1)
  assert.equal(a.at, 'b')
  assert.deepEqual(a.items, q.items)          // 翻页不动任何一条
  assert.equal(goto(a, -5).at, 'a')           // 到头停住，不回绕
  assert.equal(goto(a, 99).at, 'c')
})

test('inQueue', () => {
  assert.equal(inQueue(q3(), 'b'), true)
  assert.equal(inQueue(q3(), 'zz'), false)
})

test('normalize 挡住存坏了的东西：非法项、重复 id、指不到人的光标', () => {
  const got = normalize({
    items: [{ id: 'a' }, null, { id: 'a' }, { nope: 1 }, { id: 'b', skipped: 1 }],
    at: 'ghost',
  })
  assert.deepEqual(ids(got), ['a', 'b'])
  assert.equal(got.items[1].skipped, true)
  assert.equal(got.at, 'a')
})

test('normalize 收到垃圾就还一个空队', () => {
  assert.deepEqual(normalize(null), EMPTY)
  assert.deepEqual(normalize({ items: 'nope' }), EMPTY)
})

test('存进去读回来是同一份', () => {
  globalThis.localStorage = {
    _d: {},
    getItem(k) { return k in this._d ? this._d[k] : null },
    setItem(k, v) { this._d[k] = String(v) },
  }
  const q = later(q3(), 'a', '2026-08-06')
  saveQueue(q)
  assert.deepEqual(loadQueue(), q)
})
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `npm test`
Expected: FAIL，报 `Cannot find module '.../src/lib/queue.js'`

- [ ] **Step 3: 写实现**

创建 `src/lib/queue.js`：

```js
// 过卡队列 —— 手头这摊活。
//
// 它是**一份待办，不是一趟班次**：没做完的一直在。所以顶栏那个数字说的是
// 一句实话——「你还欠着几件事」。它只降在你按「做完了」的时候：
// 翻页（goto）什么都不改，「再等一等」（later）也不把卡拿走。
//
// 存 localStorage，**不上库**。它是「你这台机器上手头的活」，不是事实。
// 事实（新信、草稿、next_action）全都已经在库里了——队列丢了，一样东西都不会
// 消失，只是要你自己去看板上找。所以这儿只存 id 和「什么送它进来的」，
// 内容永远从库里读。

const KEY = 'pa_queue'

/** items: [{id, via, skipped, skippedAt}] · at: 你正看着那张的 pursuit_id */
export const EMPTY = { items: [], at: null }

/** 今天，'YYYY-MM-DD'。传得进来是为了测试能写死日期。 */
const todayStr = () => {
  const d = new Date()
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 存进去的东西可能是上个版本写的、可能被手改坏了。读回来一律过一遍这里。
 * 挡三样：非法项、重复的 id（重复了那个数字立刻没意义）、指不到人的光标。
 */
export function normalize(raw) {
  if (!raw || !Array.isArray(raw.items)) return EMPTY
  const seen = new Set()
  const items = []
  for (const x of raw.items) {
    if (!x || typeof x.id !== 'string' || seen.has(x.id)) continue
    seen.add(x.id)
    items.push({
      id: x.id,
      // via = 什么送它进来的。第一刀只有 'pick'（你自己端上来的）；
      // 第二刀会有收信 / 待办作废 / 新的下一步。字段先留着，免得那时候还要迁存储。
      via: x.via || 'pick',
      skipped: Boolean(x.skipped),
      skippedAt: x.skippedAt || null,
    })
  }
  if (!items.length) return EMPTY
  const at = items.some((x) => x.id === raw.at) ? raw.at : items[0].id
  return { items, at }
}

export function loadQueue() {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY) || 'null'))
  } catch (_) {
    return EMPTY
  }
}

export function saveQueue(q) {
  try { localStorage.setItem(KEY, JSON.stringify(q)) } catch (_) {}
}

/** 从 from 开始找第一张没被放过的；找不到就往前找；再找不到就随便给一张（全放过了）。 */
function liveAt(items, from) {
  for (let i = from; i < items.length; i++) if (!items[i].skipped) return items[i].id
  for (let i = Math.min(from, items.length) - 1; i >= 0; i--) if (!items[i].skipped) return items[i].id
  return items[Math.min(from, items.length - 1)]?.id ?? null
}

/** 光标该不该动：你在别处按的按钮，不该把你正看的那张挪走。 */
function keepOrMove(items, q, id, from) {
  if (q.at !== id && items.some((x) => x.id === q.at)) return q.at
  return liveAt(items, from)
}

/**
 * 往队里塞。
 * **已经在队里的不再插一份**，只更新 via 并清掉「先放着」——它变了，值得你再看一眼。
 * 不然同一条线在队里躺三份，顶栏那个数字立刻就没意义了。
 */
export function enqueue(q, entries) {
  const items = q.items.slice()
  for (const e of entries || []) {
    if (!e || typeof e.id !== 'string') continue
    const i = items.findIndex((x) => x.id === e.id)
    if (i >= 0) items[i] = { ...items[i], via: e.via || items[i].via, skipped: false, skippedAt: null }
    else items.push({ id: e.id, via: e.via || 'pick', skipped: false, skippedAt: null })
  }
  if (!items.length) return EMPTY
  const at = items.some((x) => x.id === q.at) ? q.at : items[0].id
  return { items, at }
}

/** 做完了：拿走。这是唯一让顶栏数字降下去的路。 */
export function done(q, id) {
  const i = q.items.findIndex((x) => x.id === id)
  if (i < 0) return q
  const items = q.items.filter((x) => x.id !== id)
  if (!items.length) return EMPTY
  return { items, at: keepOrMove(items, q, id, i) }
}

/**
 * 再等一等：**留着**，挪队尾，打上「你先放着了」。
 * 数字不降——它还欠着。挪队尾只是为了这一轮不再挡你。
 */
export function later(q, id, on = todayStr()) {
  const i = q.items.findIndex((x) => x.id === id)
  if (i < 0) return q
  const moved = { ...q.items[i], skipped: true, skippedAt: on }
  const items = [...q.items.slice(0, i), ...q.items.slice(i + 1), moved]
  return { items, at: keepOrMove(items, q, id, i) }
}

/** 你正看着的是第几张（0 起）。不在队里返回 -1。 */
export function indexOf(q) {
  return q.items.findIndex((x) => x.id === q.at)
}

/** ‹ › 翻页。**什么都不改**，只移动光标——翻回来那张原样在那儿。到头就停住，不回绕。 */
export function goto(q, delta) {
  if (!q.items.length) return q
  const i = indexOf(q)
  const n = Math.max(0, Math.min(q.items.length - 1, (i < 0 ? 0 : i) + delta))
  return { ...q, at: q.items[n].id }
}

/** 剩下的是不是你这一轮全放过了。空队返回 false —— 没有"剩下的"。 */
export function allSkipped(q) {
  return q.items.length > 0 && q.items.every((x) => x.skipped)
}

export function inQueue(q, id) {
  return q.items.some((x) => x.id === id)
}
```

- [ ] **Step 4: 跑测试，确认全绿**

Run: `npm test`
Expected: PASS，两个文件共 21 个测试全过

- [ ] **Step 5: 提交**

```bash
git add src/lib/queue.js src/lib/queue.test.js
git commit -m "过卡队列：一份待办，不是一趟班次

数字只降在你按「做完了」的时候。翻页什么都不改，「再等一等」留着挪队尾。
不重复塞 —— 同一条线躺三份，那个数字立刻就没意义了。"
```

---

### Task 3: 工具条换成两个开关，看板真的筛

**Files:**
- Create: `src/components/Subbar.jsx`
- Modify: `src/App.jsx`（删 233-245 那段内联工具条，加 `filters` 状态 + `shown`）
- Modify: `src/components/Pipeline.jsx`（加 `emptyNote`）
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `FILTERS`、`NO_FILTERS`、`anyOn`、`applyFilters`（Task 1）
- Produces:
  - `<Subbar>` props：`filters`、`onToggleFilter(key)`、`onOpenTasks`（Task 4 会往里加选择模式那几个）
  - `<Pipeline>` 新增 prop：`emptyNote: string | null`

- [ ] **Step 1: 写 Subbar 组件**

创建 `src/components/Subbar.jsx`：

```jsx
import React from 'react'
import { FILTERS } from '../lib/filters.js'

// 二级工具条：**左边镜头（看哪些），右边动作（干什么）。**
//
// 原来这儿是四个死 tab（按阶段/按截止/按作品/按来源）。撤了，不留位——
// 它们说的是「怎么排」，而看板已经按阶段排了，天生互相打架。
// 空着可以，假着不行。
export default function Subbar({ filters, onToggleFilter, onOpenTasks }) {
  return (
    <div className="subbar">
      {/* 两个开关，可以同时按下去 —— 真正有用的恰恰是交叉。
          所以没有「全部」那个按钮：它就是"什么都不按"。 */}
      <div className="tabs" role="group" aria-label="看哪些">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={'tab' + (filters[key] ? ' on' : '')}
            aria-pressed={Boolean(filters[key])}
            onClick={() => onToggleFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <span className="sp" />

      <button className="wbtn" onClick={onOpenTasks}>造卡任务</button>
    </div>
  )
}
```

- [ ] **Step 2: 接进 App**

在 `src/App.jsx` 顶部的 import 区加两行：

```js
import Subbar from './components/Subbar.jsx'
import { NO_FILTERS, anyOn, applyFilters } from './lib/filters.js'
```

在 `const [tasksOpen, setTasksOpen] = useState(false)` 下面加一行状态：

```js
  // 看哪些。两个开关都关 = 全部。切镜头只改看得见什么，不改任何数据。
  const [filters, setFilters] = useState(NO_FILTERS)
```

在 `const onPursuit = ...` 那几行**上面**加：

```js
  // 当前镜头里看得见的卡。Pipeline 拿这一份画，所以列头的计数天然就是
  // 「当前视图里的张数」——不是总数。（不然你筛完看见「新机会 26」下面只有
  // 3 张，那个 26 在骗人。）
  const shown = applyFilters(pl.pursuits, filters)
  const toggleFilter = (key) => setFilters((f) => ({ ...f, [key]: !f[key] }))
  // 筛出来一张都没有，说人话。「待处理」大概率就是很稀——0017 撤掉「从 stage
  // 猜球权」之后，有依据的待处理从 28 张掉到 1 张。那是真的，不是筛坏了。
  const emptyNote = !shown.length && anyOn(filters)
    ? (filters.mine && filters.urgent ? '没有既该你动、又快到期的线。'
      : filters.mine ? '现在没有球在你这边的线。'
      : '没有 14 天内到期的线。')
    : null
```

把 `{area === 'pursue' && !paged && (` 底下那整段内联的 `<div className="subbar">…</div>`（含四个 `<button className="tab">` 和「造卡任务」）**整块删掉**，换成：

```jsx
      {area === 'pursue' && !paged && (
        <Subbar
          filters={filters}
          onToggleFilter={toggleFilter}
          onOpenTasks={() => setTasksOpen(true)}
        />
      )}
```

把 `<Pipeline pursuits={pl.pursuits} ...>` 那一行改成：

```jsx
          <Pipeline pursuits={shown} emptyNote={emptyNote} tasks={tk.tasks} onOpen={openPursuit} onMove={moveCard} onTick={tickAction} onJot={jotCard} unseen={unseen} />
```

- [ ] **Step 3: Pipeline 接住 emptyNote**

改 `src/components/Pipeline.jsx` 的组件签名和 return：

```jsx
export default function Pipeline({ pursuits, tasks = [], onOpen, onMove, onTick, onJot, unseen = new Set(), emptyNote = null }) {
```

在 `return (` 之前插一段：

```jsx
  // 筛得一张不剩的时候，别摆七个空列——那看着像卡全丢了。
  if (emptyNote) {
    return <div className="board board-empty">{emptyNote}</div>
  }
```

- [ ] **Step 4: 加样式**

在 `src/styles.css` 里，紧接 `.tab:hover:not(.on)` 那行（第 65 行）后面插入：

```css
/* 两个开关是「按下去」不是「选中一个」，所以两个可以同时亮。
   .on 的样子沿用原来的 tab 选中态，不另起一套。 */
.tab[aria-pressed="true"] { color: var(--ink); background: var(--paper-2); border-color: var(--line-2); font-weight: 600; }
.tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

在 `.board { ... }` 那一条（第 85 行附近）后面插入：

```css
/* 筛没了的时候说人话。「待处理」很稀是真的，不是筛坏了。 */
.board-empty { display: block; padding: 60px 26px; color: var(--ink-3); font-family: var(--serif); font-size: 14px; }
```

- [ ] **Step 5: 在浏览器里验**

Run: `npm run dev`，开 http://localhost:5173

逐条确认：
1. 工具条上是「待处理」「紧急」两个按钮 + 右边「造卡任务」。**四个旧 tab 没了。**
2. 点「紧急」→ 只剩 14 天内到期的卡，**列头计数跟着变小**。
3. 「待处理」和「紧急」**能同时按下去**，都高亮，卡更少。
4. 两个都关掉 → 卡全回来了，一张不少。
5. 按到一张不剩时，看板位置显示一句话，不是七个空列。
6. 抽屉、拖拽、勾待办这些老功能没坏。

- [ ] **Step 6: 提交**

```bash
git add src/components/Subbar.jsx src/App.jsx src/components/Pipeline.jsx src/styles.css
git commit -m "四个死 tab 换成两个真能筛的开关

按阶段/按截止/按作品/按来源说的都是「怎么排」，而看板已经按阶段排了 ——
天生打架，所以两天都接不上。换成说「看哪些」的两个开关，七列照旧只是变稀，
而且能同时按下去（真正有用的是交叉）。"
```

---

### Task 4: 选择模式 + 「过一遍」+ 顶栏入口

**Files:**
- Modify: `src/components/Subbar.jsx`（工具条换脸）
- Modify: `src/components/Pipeline.jsx`（卡上的勾选框 + 叠的半选）
- Modify: `src/App.jsx`（`picking` / `picked` / `queue` 状态 + 顶栏按钮）
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `loadQueue`、`saveQueue`、`normalize`、`enqueue`（Task 2）
- Produces:
  - `<Subbar>` 新增 props：`picking`、`pickedCount`、`hiddenPickedCount`、`onStartPick`、`onCancelPick`、`onPickAll`
  - `<Pipeline>` 新增 props：`picking: boolean`、`picked: Set<string>`、`onPick(ids: string[], on: boolean)`

- [ ] **Step 1: Subbar 换脸**

把 `src/components/Subbar.jsx` 整个替换成：

```jsx
import React from 'react'
import { FILTERS } from '../lib/filters.js'

// 二级工具条：**左边镜头（看哪些），右边动作（干什么）。**
//
// 原来这儿是四个死 tab（按阶段/按截止/按作品/按来源）。撤了，不留位——
// 它们说的是「怎么排」，而看板已经按阶段排了，天生互相打架。
// 空着可以，假着不行。
//
// 这一刀右边只有两个真按钮。「更新最新信息」是第二刀的，那时候再加——
// 现在放一个还不能用的，就是刚撤掉的那个病。
export default function Subbar({
  filters, onToggleFilter,
  picking, pickedCount, hiddenPickedCount,
  onStartPick, onCancelPick, onPickAll,
  onOpenTasks,
}) {
  return (
    <div className="subbar">
      {/* 两个开关，可以同时按下去 —— 真正有用的恰恰是交叉。
          所以没有「全部」那个按钮：它就是"什么都不按"。 */}
      <div className="tabs" role="group" aria-label="看哪些">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={'tab' + (filters[key] ? ' on' : '')}
            aria-pressed={Boolean(filters[key])}
            onClick={() => onToggleFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 切镜头**不清空**勾选（那是「看不见 = 丢了」的近亲），
          但也不能假装它们都在眼前 —— 所以照实说。 */}
      {picking && (
        <span className="pickinfo">
          已选 {pickedCount} 张
          {hiddenPickedCount > 0 && <em>（{hiddenPickedCount} 张不在当前视图）</em>}
        </span>
      )}

      <span className="sp" />

      {picking ? (
        <>
          <button className="wbtn" disabled={!pickedCount} onClick={onPickAll}>过一遍</button>
          <button className="btn" onClick={onCancelPick}>取消</button>
        </>
      ) : (
        <>
          <button className="wbtn" onClick={onStartPick}>批量操作</button>
          <button className="wbtn" onClick={onOpenTasks}>造卡任务</button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Pipeline 加勾选**

改 `src/components/Pipeline.jsx`。

**2a.** `PCard` 换成（整个函数替换，签名多了三个 prop）：

```jsx
function PCard({ p, onOpen, onDragStart, onTick, onJot, unseen, picking, checked, onPick }) {
  const dim = p.stage === 'paused' || !p.eligible
  const opencall = p.kind && p.kind !== 'workshop' // 投申请的正式机会（区别于 workshop 冷外联）
  const ball = ballOf(p)
  const ddl = deadlineLine(p)
  const act = actionLine(p)

  // 卡整体是个可点的东西，但里面还嵌了个勾选框——button 套 button 是非法的，
  // 所以外层用 div + role，键盘操作自己接。
  //
  // 批量操作开着的时候，整张卡改成「勾/取消勾」——不在卡上另开一个小热区，
  // 那种一按就按歪。角上那个方块只是给你看的，不单独接点击。
  const open = () => (picking ? onPick([p.id], !checked) : onOpen(p))
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
  }

  return (
    <div
      className={'pcard' + (opencall ? ' opencall' : '') + (picking ? ' pickable' : '') + (checked ? ' on' : '')}
      style={dim ? { opacity: 0.58 } : undefined}
      role={picking ? 'checkbox' : 'button'}
      aria-checked={picking ? checked : undefined}
      tabIndex={0}
      draggable={!picking}
      onDragStart={(e) => onDragStart(e, p)}
      onClick={open}
      onKeyDown={onKey}
    >
      {picking && <span className="pc-check" aria-hidden="true" />}
      {unseen && <span className="pc-badge" aria-label="Fairwind 回复了" />}
      {/* 球在谁那边——stage 说的是走到哪一格，这个说的是现在该谁动。 */}
      {ball && (
        <div className={'pc-ball ' + ball}>
          <span className="bd" aria-hidden="true" />{BALL_LABEL[ball]}
        </div>
      )}
      <div className="pc-t">{p.title}</div>
      {p.match_stars ? <div className="pc-stars">{'★'.repeat(p.match_stars)}</div> : null}

      {/* 该干什么——一张卡只说一句，而且每句都有确切依据。能勾的就勾掉。 */}
      {act && (
        act.tick ? (
          <button
            className={'pc-act tickable' + (act.urgent ? ' urgent' : '')}
            onClick={(e) => { e.stopPropagation(); onTick?.(p, act.tick) }}
            title="做完了？勾掉"
          >
            <span className="tick" aria-hidden="true" />
            <span className="pc-act-t">{act.text}</span>
          </button>
        ) : (
          <div className={'pc-act' + (act.urgent ? ' urgent' : '')}>{act.text}</div>
        )
      )}

      {ddl ? (
        <div className={'pc-ddl' + (ddl.urgent ? ' due' : '')}>{ddl.text}</div>
      ) : (
        <div className="pc-ddl none">无固定截止</div>
      )}
      {p.work_title && <div className="pc-p">{p.work_title}</div>}
      <Jot p={p} onSave={onJot} />
      <div className="pc-m" style={p.stage === 'won' ? { color: 'var(--good)' } : undefined}>
        <span className={'src' + (p.source === 'manual' ? '' : ' scout')} aria-hidden="true" />
        {p.contact_name ? p.contact_name + ' · ' : ''}{statusText(p)}
      </div>
    </div>
  )
}
```

**2b.** `Stack` 换成（叠头从 `<button>` 改成 `div + role`，因为里面要嵌一个真的勾选按钮——跟 PCard 一样的理由）：

```jsx
// 一叠：同一个造卡任务造出来的一批，默认折着，只递一件事——「这儿有一叠，22 张」。
function Stack({ name, items, open, onToggle, onOpen, onDragStart, onTick, onJot, unseen, picking, picked, onPick }) {
  // 折着的时候只报一个数：这一叠里有几张在等你动。比「几张该跟进」更接近你要问的那句话。
  const mine = items.filter((p) => ballOf(p) === 'me').length
  const anyUnseen = items.some((p) => unseen?.has(p.id))
  // 「找 workshop 机构 · 15 张」那种场景，冷邮件本来就是一批一批起的——
  // 所以叠头上要能一次勾全叠。不展开也能勾。
  const hit = items.filter((p) => picked?.has(p.id)).length
  const allOn = hit === items.length && hit > 0
  const ids = items.map((p) => p.id)

  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
  }

  return (
    <div className={'stack' + (open ? ' open' : '')}>
      <div className="stack-head" role="button" tabIndex={0} onClick={onToggle} onKeyDown={onKey}>
        {picking && (
          <button
            type="button"
            className={'pc-check st' + (allOn ? ' on' : hit ? ' half' : '')}
            role="checkbox"
            aria-checked={allOn ? 'true' : hit ? 'mixed' : 'false'}
            aria-label={`勾选这一叠 ${items.length} 张`}
            onClick={(e) => { e.stopPropagation(); onPick(ids, !allOn) }}
          />
        )}
        <span className="stack-pile" aria-hidden="true" />
        {anyUnseen && !open && <span className="pc-badge" aria-label="Fairwind 回复了" />}
        <span className="stack-txt">
          <span className="stack-n">{name || '一批机构'}</span>
          <span className="stack-c">
            {items.length} 张{mine ? ` · ${mine} 张待处理` : ''}
            {picking && hit ? ` · 已选 ${hit}` : ''}
          </span>
        </span>
        <span className="stack-chev" aria-hidden="true">{open ? '收起' : '展开'}</span>
      </div>
      {open && items.map((p) => (
        <PCard
          p={p} key={p.id} onOpen={onOpen} onDragStart={onDragStart} onTick={onTick} onJot={onJot}
          unseen={unseen?.has(p.id)} picking={picking} checked={picked?.has(p.id)} onPick={onPick}
        />
      ))}
    </div>
  )
}
```

**2c.** 组件签名和两处渲染：

```jsx
export default function Pipeline({ pursuits, tasks = [], onOpen, onMove, onTick, onJot, unseen = new Set(), emptyNote = null, picking = false, picked = new Set(), onPick }) {
```

`layout(items).map((row) =>` 那两个分支换成：

```jsx
              row.stack ? (
                <Stack
                  key={row.stack}
                  name={taskName(row.stack)}
                  items={row.items}
                  open={openStacks.has(row.stack)}
                  onToggle={() => toggleStack(row.stack)}
                  onOpen={onOpen}
                  onDragStart={onDragStart}
                  onTick={onTick}
                  onJot={onJot}
                  unseen={unseen}
                  picking={picking}
                  picked={picked}
                  onPick={onPick}
                />
              ) : (
                <PCard
                  p={row.card} key={row.card.id} onOpen={onOpen} onDragStart={onDragStart}
                  onTick={onTick} onJot={onJot} unseen={unseen.has(row.card.id)}
                  picking={picking} checked={picked.has(row.card.id)} onPick={onPick}
                />
              )
```

- [ ] **Step 3: App 接线**

在 import 区加：

```js
import { loadQueue, saveQueue, normalize, enqueue } from './lib/queue.js'
```

在 `const [filters, setFilters] = useState(NO_FILTERS)` 下面加：

```js
  // 批量操作：你勾出来的那一批。切镜头不清空 —— 切一下就无声无息没了，
  // 那是「看不见 = 丢了」的近亲。
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  // 手头这摊活。存 localStorage，不上库（见 lib/queue.js 开头）。
  const [queue, setQueue] = useState(loadQueue)

  // 这一行必须待在这儿（状态旁边），不能挪到组件下半截去。
  // 下面那个 Esc 的 useEffect 会用它，而那个 effect 在「载入中」的早退 return
  // **上面**——定义写在早退下面的话，数据还没到时按 Esc 就是 TDZ 报错。
  const cancelPick = () => { setPicking(false); setPicked(new Set()) }
```

在 `useEffect(() => { loadLibrary()... })` 那块下面加一个 effect：

```js
  useEffect(() => { saveQueue(queue) }, [queue])

  // 库换过之后（seed ↔ live，id 完全是两套），localStorage 里可能躺着一批
  // 已经不存在的 id。不清掉的话顶栏会显示一个点了没反应的数字——那是在说谎。
  useEffect(() => {
    if (!pl) return
    const live = new Set(pl.pursuits.map((p) => p.id))
    setQueue((q) => {
      const items = q.items.filter((x) => live.has(x.id))
      return items.length === q.items.length ? q : normalize({ items, at: q.at })
    })
  }, [pl])
```

在已有的 `onStorage` 那个 effect 里，把处理函数改成：

```js
    const onStorage = (e) => {
      if (e.key === 'pa_seen') { try { setSeen(JSON.parse(e.newValue || '{}')) } catch (_) {} }
      // 别的标签页把一张卡结掉了，这个标签页顶栏的数字也跟着降。
      if (e.key === 'pa_queue') { try { setQueue(normalize(JSON.parse(e.newValue || 'null'))) } catch (_) {} }
    }
```

在 `const emptyNote = ...` 下面加：

```js
  // 勾了但当前镜头看不见的那几张。照实说出来，不假装它们都在眼前。
  const shownIds = new Set(shown.map((p) => p.id))
  const hiddenPicked = [...picked].filter((id) => !shownIds.has(id)).length

  const pick = (ids, on) => setPicked((s) => {
    const next = new Set(s)
    for (const id of ids) on ? next.add(id) : next.delete(id)
    return next
  })

  // 打开队里的某一张。队列和 view 是两件事：view 说「抽屉现在看哪张」，
  // 队列说「你还欠着哪几件」。收起抽屉不动队列。
  const openQueueCard = (id) => {
    const p = pl.pursuits.find((x) => x.id === id)
    if (p) { markSeen(id); setView({ name: 'pursuit', pursuit: p, mode: 'drawer' }) }
  }

  // 过一遍：不跑任何东西，直接把勾中的端上工作台。
  const pickAll = () => {
    const entries = [...picked].map((id) => ({ id, via: 'pick' }))
    if (!entries.length) return
    const q = enqueue(queue, entries)
    setQueue(q)
    cancelPick()
    openQueueCard(q.at)
  }
```

把 `<Subbar ... />` 换成：

```jsx
        <Subbar
          filters={filters}
          onToggleFilter={toggleFilter}
          picking={picking}
          pickedCount={picked.size}
          hiddenPickedCount={hiddenPicked}
          onStartPick={() => setPicking(true)}
          onCancelPick={cancelPick}
          onPickAll={pickAll}
          onOpenTasks={() => setTasksOpen(true)}
        />
```

`<Pipeline ... />` 那行加三个 prop：

```jsx
          <Pipeline pursuits={shown} emptyNote={emptyNote} tasks={tk.tasks} onOpen={openPursuit} onMove={moveCard} onTick={tickAction} onJot={jotCard} unseen={unseen} picking={picking} picked={picked} onPick={pick} />
```

顶栏：把 `<nav className="areas">...</nav>` 后面那行 `<span className="sp" />` 换成：

```jsx
        <span className="sp" />
        {/* 队空的时候整个按钮不渲染。不显示「过卡 · 0」——这一刀刚撤掉四个占位的。 */}
        {queue.items.length > 0 && (
          <button className="qbtn" onClick={() => openQueueCard(queue.at)}>
            <span className="qpile" aria-hidden="true" />过卡 · {queue.items.length}
          </button>
        )}
```

Esc 那个 effect 里，把 `if (tasksOpen) setTasksOpen(false)` 那条**前面**插一条（Esc 先退出选择模式）：

```js
      if (picking) cancelPick()
      else if (tasksOpen) setTasksOpen(false)
```

并把该 effect 的依赖数组从 `[tasksOpen, view]` 改成 `[tasksOpen, view, picking]`。

- [ ] **Step 4: 加样式**

在 `src/styles.css` 的 `.wbtn:hover` 那行（第 68 行附近）后面插入：

```css
.wbtn:disabled { opacity: .4; cursor: default; border-color: var(--line); }
.wbtn:disabled:hover { border-color: var(--line); }
/* 勾了几张 —— 不在当前视图里的照实说。 */
.pickinfo { font-size: 12.5px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.pickinfo em { font-style: normal; color: var(--ink-3); }

/* 顶栏的过卡入口。像一叠东西，不像一个通知。 */
.qbtn { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 12.5px; font-weight: 600;
  padding: 6px 14px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--paper-2);
  color: var(--ink); cursor: pointer; font-variant-numeric: tabular-nums; }
.qbtn:hover { border-color: var(--accent); }
.qbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.qpile { width: 8px; height: 8px; border-radius: 2px; background: var(--accent); flex: none;
  box-shadow: 2px -2px 0 -1px var(--paper-2), 3px -3px 0 0 var(--accent); }
```

在 `.pcard.opencall::before` 那行（第 127 行附近）后面插入：

```css
/* 批量操作开着的时候，整张卡就是个勾选框。角上那个方块只是给你看的。 */
.pcard.pickable { cursor: pointer; padding-left: 36px; }
.pcard.pickable:active { cursor: pointer; }
.pcard.pickable.on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow); }
.pc-check { position: absolute; left: 13px; top: 14px; width: 15px; height: 15px; border-radius: 4px;
  border: 1.5px solid var(--line-2); background: var(--paper); flex: none; padding: 0; cursor: pointer; }
.pcard.on > .pc-check, .pc-check.on { background: var(--accent); border-color: var(--accent); }
.pcard.on > .pc-check::after, .pc-check.on::after {
  content: ''; position: absolute; left: 4px; top: 1px; width: 4px; height: 8px;
  border: solid var(--paper-2); border-width: 0 1.7px 1.7px 0; transform: rotate(42deg); }
/* 半选：这一叠勾了几张但没勾全 */
.pc-check.half { border-color: var(--accent); }
.pc-check.half::after { content: ''; position: absolute; left: 3px; top: 6px; width: 7px; height: 0;
  border-top: 1.7px solid var(--accent); }
/* 叠头上那个跟着排版走，不绝对定位。但仍要 relative——
   里面那个勾（::after）是绝对定位的，没有它就会跑到 .stack-head 的角上去。 */
.pc-check.st { position: relative; left: auto; top: auto; margin-right: 2px; }
.pc-check:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

- [ ] **Step 5: 在浏览器里验**

Run: `npm run dev`

逐条确认：
1. 点「批量操作」→ 每张卡左上角出现空方块，工具条右边变成「过一遍 / 取消」，「过一遍」是灰的。
2. 点几张卡 → 方块打勾、卡描边变琥珀色，工具条显示「已选 N 张」，「过一遍」亮了。
3. **勾着的时候按「紧急」**→ 卡少了，但「已选 N 张（M 张不在当前视图）」的 N 没变。**关掉「紧急」，勾还在。**
4. 一叠的叠头上有方块：点它勾全叠；勾一部分再看叠头 → 半选（一条横杠）；叠头文案多一句「已选 X」。
5. 点叠头文字部分仍然是展开/收起，不会误勾。
6. 按「过一遍」→ 选择模式退出，右边划出抽屉，**顶栏出现「过卡 · N」**。
7. 关掉抽屉（✕ 或 Esc）→ 顶栏那个「过卡 · N」**还在**，数字没变。点它 → 抽屉又开回那张。
8. **刷新页面** → 顶栏「过卡 · N」还在。
9. 选择模式下按 Esc → 退出选择模式，勾清空，抽屉没被打开。
10. 队列为空时（清掉 localStorage 的 `pa_queue` 再刷新）→ 顶栏**没有**那个按钮。

- [ ] **Step 6: 提交**

```bash
git add src/components/Subbar.jsx src/components/Pipeline.jsx src/App.jsx src/styles.css
git commit -m "选择模式 + 过一遍 + 顶栏入口

切镜头不清空勾选（切一下就无声无息没了，是「看不见 = 丢了」的近亲），
但照实说「M 张不在当前视图」。叠头能一次勾全叠 —— 冷邮件本来就是一批一批起的。
队空的时候顶栏那个按钮整个不渲染，不显示「过卡 · 0」。"
```

---

### Task 5: 抽屉的队头、两个出口、和停手面板

**Files:**
- Create: `src/components/QueueRest.jsx`
- Modify: `src/components/PursuitFocus.jsx`（队头 + 两个出口）
- Modify: `src/App.jsx`（队列导航的三个 handler + 抽屉分支）
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `done`、`later`、`goto`、`indexOf`、`allSkipped`、`inQueue`（Task 2）
- Produces:
  - `<PursuitFocus>` 新增 props：
    - `queue: {i: number, n: number, skippedAt: string|null} | null`
    - `onQueuePrev()`、`onQueueNext()`、`onQueueDone()`、`onQueueLater()`
  - `<QueueRest n={number} onClose={fn} />`

- [ ] **Step 1: 写停手面板**

创建 `src/components/QueueRest.jsx`：

```jsx
import React from 'react'

// 剩下的你这一轮全放过了。不无限转圈——转圈会让你以为还有活没干完，
// 其实你每一张都看过了、都决定了先不动。
export default function QueueRest({ n, onClose }) {
  return (
    <div className="qrest">
      <p className="qrest-t">剩下 {n} 张这轮你都先放着了</p>
      <p className="qrest-s">它们还在队里，明天再来。</p>
      <button className="btn" onClick={onClose}>收起</button>
    </div>
  )
}
```

- [ ] **Step 2: PursuitFocus 加队头和出口**

改 `src/components/PursuitFocus.jsx`。

**2a.** 组件签名加五个 prop（找到 `export default function PursuitFocus(` 那一行，把参数解构里补上）：

```jsx
  queue = null, onQueuePrev, onQueueNext, onQueueDone, onQueueLater,
```

**2b.** 在 `<div className="focus-top">` 里、`<div className="ft-head">` **上面**插入队头：

```jsx
        {/* 队头。翻页什么都不改——翻回来那张原样在那儿，所以 ‹ › 旁边
            没有任何「已处理」的标记，只有位置。 */}
        {queue && (
          <div className="qnav">
            <button className="qarrow" onClick={onQueuePrev} disabled={queue.i <= 0} aria-label="上一张">‹</button>
            <span className="qcount">{queue.i + 1} / {queue.n}</span>
            <button className="qarrow" onClick={onQueueNext} disabled={queue.i >= queue.n - 1} aria-label="下一张">›</button>
            {queue.skippedAt && <span className="qskip">{queue.skippedAt} 你先放着了</span>}
          </div>
        )}
```

**2c.** 最后那个 `return` 的三元表达式（`{threeCol ? (...) : body}`）换成：

```jsx
      {threeCol ? (
        <div className="focus-cols">
          <aside className="fc-l">
            <Dossier
              p={p}
              msgs={msgs}
              files={deliv.filter((d) => d.status === 'final')}
              attachments={atts}
              onUnfinal={unfinal}
              onJump={jumpTo}
              onSync={doSync}
              syncing={syncing}
              syncNote={syncNote}
            />
          </aside>
          <div className="fc-m">{body}</div>
          <aside className="fc-r">
            <Deliverables
              pursuitId={p.id}
              items={deliv}
              files={deliv.filter((d) => d.status === 'final')}
              onChanged={reloadDeliv}
              onJump={jumpTo}
            />
          </aside>
        </div>
      ) : (
        <>
          {body}
          {/* 两个出口。**只有「做完了」让顶栏那个数字降下去**——
              「再等一等」把这张留在队里挪到队尾，它还欠着。 */}
          {queue && (
            <div className="qexits">
              <button className="wbtn" onClick={onQueueDone}>做完了</button>
              <button className="btn" onClick={onQueueLater}>再等一等</button>
            </div>
          )}
        </>
      )}
```

- [ ] **Step 3: App 接线**

import 区那行改成：

```js
import { loadQueue, saveQueue, normalize, enqueue, done as queueDone, later as queueLater, goto as queueGoto, allSkipped, inQueue } from './lib/queue.js'
import QueueRest from './components/QueueRest.jsx'
```

在 `AREAS` 那个常量下面（组件外）加一个小工具：

```js
// '2026-08-06' → '8/6'。两位数的月日都要去掉前导零，
// 直接 slice + 一次 replace 只去得掉月份那个，会写出「8/06」。
const mdOf = (s) => {
  if (!s) return null
  const [, m, d] = s.split('-')
  return `${Number(m)}/${Number(d)}`
}
```

在 `const pickAll = () => {...}` 下面加：

```js
  // 抽屉正看的这张在不在队里。在 = 显示队头和两个出口。
  const atQueue = view.name === 'pursuit' && inQueue(queue, view.pursuit.id)
  const qItem = atQueue ? queue.items.find((x) => x.id === view.pursuit.id) : null
  const qInfo = atQueue ? {
    i: queue.items.findIndex((x) => x.id === view.pursuit.id),
    n: queue.items.length,
    // '2026-08-06' → '8/6'。你什么时候放过它的，得看得见。
    skippedAt: mdOf(qItem?.skippedAt),
  } : null
  // 剩下的全放过了：抽屉不再摆卡，改摆一句话然后停手。
  const resting = atQueue && allSkipped(queue)

  const queueGo = (d) => {
    const q = queueGoto({ ...queue, at: view.pursuit.id }, d)
    setQueue(q)
    openQueueCard(q.at)
  }
  const finishCard = () => {
    const q = queueDone(queue, view.pursuit.id)
    setQueue(q)
    if (!q.items.length) closePursuit()
    else openQueueCard(q.at)
  }
  const laterCard = () => {
    const q = queueLater(queue, view.pursuit.id)
    setQueue(q)
    // 全放过了的时候不换卡——App 会改摆停手面板。
    if (!allSkipped(q)) openQueueCard(q.at)
  }
```

（`indexOf` 这儿用不上——`qInfo.i` 直接算了，所以 import 里没有它。）

抽屉那一段（`{drawered && (<aside className="drawer" ...>)}`）换成：

```jsx
          {drawered && (
            <aside className="drawer" aria-label={resting ? '过卡' : view.pursuit.title}>
              {resting ? (
                <QueueRest n={queue.items.length} onClose={closePursuit} />
              ) : (
                <PursuitFocus
                  key={view.pursuit.id}
                  variant="drawer"
                  pursuit={view.pursuit}
                  messages={pl.messagesByPursuit[view.pursuit.id]}
                  onBack={closePursuit}
                  onExpand={expandPursuit}
                  onMove={moveCard}
                  onSetBall={markBall}
                  queue={qInfo}
                  onQueuePrev={() => queueGo(-1)}
                  onQueueNext={() => queueGo(1)}
                  onQueueDone={finishCard}
                  onQueueLater={laterCard}
                />
              )}
            </aside>
          )}
```

- [ ] **Step 4: 加样式**

在 `src/styles.css` 里 `.focus.drawer .stg-lbl` 那行（第 155 行附近）后面插入：

```css
/* ── 过卡：队头 + 两个出口 ── */
/* 队头只报位置。翻页什么都不改，所以这儿没有任何「已处理」的记号。 */
.qnav { display: flex; align-items: center; gap: 8px; padding: 0 0 9px; margin-bottom: 2px;
  border-bottom: 1px solid var(--line); }
.qarrow { font: inherit; font-size: 16px; line-height: 1; width: 26px; height: 26px; border-radius: 7px;
  border: 1px solid var(--line-2); background: var(--paper-2); color: var(--ink); cursor: pointer; }
.qarrow:hover:not(:disabled) { border-color: var(--accent); }
.qarrow:disabled { opacity: .35; cursor: default; }
.qarrow:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.qcount { font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
/* 你什么时候放过它的。放过 ≠ 翻过去，所以得留个痕。 */
.qskip { font-size: 11.5px; color: var(--ink-3); margin-left: auto; }

/* 两个出口。「做完了」是唯一让顶栏数字降下去的路，所以它是实心那个。 */
.qexits { flex: none; display: flex; gap: 9px; padding: 11px 14px;
  border-top: 1px solid var(--line); background: var(--paper-2); }

/* 剩下的全放过了。不无限转圈。 */
.qrest { flex: 1; display: flex; flex-direction: column; align-items: flex-start; justify-content: center;
  gap: 9px; padding: 0 26px; }
.qrest-t { font-family: var(--serif); font-size: 15px; font-weight: 600; margin: 0; }
.qrest-s { font-size: 12.5px; color: var(--ink-3); margin: 0 0 6px; }
```

- [ ] **Step 5: 在浏览器里验**

Run: `npm run dev`

逐条确认（先「批量操作」勾 4 张，按「过一遍」）：
1. 抽屉顶上出现 `‹ 1 / 4 ›`，左箭头是灰的。底部出现「做完了 / 再等一等」。
2. 按 `›` 翻到第 2 张 → 显示 `2 / 4`，**顶栏还是「过卡 · 4」**。翻到底右箭头变灰。
3. 按 `‹` 翻回来 → 卡原样在那儿，什么都没变。
4. 按「做完了」→ 这张从队里没了，自动跳到下一张，显示 `1 / 3`，**顶栏变成「过卡 · 3」**。
5. 按「再等一等」→ 跳到下一张，**顶栏数字不降**；一路 `›` 翻到最后一张 → 刚才那张在队尾，队头显示 `8/6 你先放着了`。
6. 把剩下的全部「再等一等」→ 抽屉改摆「剩下 N 张这轮你都先放着了」+「收起」，不再摆卡。
7. 点「收起」→ 抽屉关了，**顶栏「过卡 · N」还在**，数字是全部剩下的张数。
8. 刷新页面 → 顶栏数字一样；点它 → 抽屉开回队里那张（放过的记号还在）。
9. 把最后一张「做完了」→ 队空了，抽屉自动关，**顶栏那个按钮消失**。
10. **不在队里的卡**（从看板直接点开）→ 抽屉顶上**没有** `‹ ›`，底部**没有**两个出口，跟以前一模一样。
11. 整页（`?p=<id>`）打开一条线 → 三栏照旧，没有队头、没有出口。

- [ ] **Step 6: 跑一遍全部测试 + 构建**

Run: `npm test && npm run build`
Expected: 21 个测试全过，build 成功无报错

- [ ] **Step 7: 提交**

```bash
git add src/components/QueueRest.jsx src/components/PursuitFocus.jsx src/App.jsx src/styles.css
git commit -m "过卡器：抽屉的队头、两个出口、停手面板

翻页什么都不改，「再等一等」留着挪队尾并留下「几号你先放着了」的痕，
只有「做完了」让顶栏数字降。剩下的全放过了就摆一句话停手，不无限转圈。"
```

---

## 第一刀之后手上有什么

- 工具条：`待处理` / `紧急` 两个能同时按下去的开关 + `批量操作` + `造卡任务`
- 勾一批卡（含整叠一次勾）→ `过一遍` → 端进抽屉挨个过
- 顶栏 `过卡 · N`，收起还在、刷新还在、跨标签页同步
- 两个出口语义分明：`做完了` 降数字，`再等一等` 不降

**没有的**（按规格，属于第二 / 第三刀）：`更新最新信息` 那个按钮、收信、清过期、重提下一步、批量起草邮件。工具条上不会出现它们的占位——放一个还不能用的按钮，正是这一刀撤掉四个死 tab 要治的病。
