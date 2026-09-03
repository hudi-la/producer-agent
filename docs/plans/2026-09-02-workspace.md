# 工作区（桌面和架子）施工计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一级导航头一个加「工作区」，二级带子只在它底下出现、装开着的窗口；过卡队列并进来当桌子；三组视图切换和带子上的动作按钮撤走。

**Architecture:** 桌子就是现有的 `lib/queue.js` 那份本地存档（`{items:[{kind,id,via}], at}`），加一种 kind='org'，去掉「再等一等」。App 里 `area` 多一个 `'desk'`；在 desk 区，看什么由 `queue.at` 决定（不再用 `view`）；在别的区，`view` 只表示抽屉（线 / 人 / 机构三种）。地址栏规则改成一句话：**带 `d=1` 是某个区旁边的抽屉，不带就是桌上那张。** 二级带子 `Subbar.jsx` 整个删掉，换成 `DeskTabs.jsx`；动作按钮进各区自己的一行 `.areabar`。

**Tech Stack:** React 18 + Vite，测试用 `node --test`（`npm test` 跑 `src/lib/*.test.js`）。界面用 Playwright MCP 截图核对。

**Spec:** `docs/specs/2026-09-02-workspace-design.md`

## Global Constraints

- **绝不丢信息**：已有的队列存档（localStorage `pa_queue`，旧格式无 kind / 带 skipped）读回来一项都不许丢。
- **dev server 他自己起**：需要截图时先 `lsof -iTCP -sTCP:LISTEN -P | grep -i node` 看 vite 在不在（默认 5173）；不在就停下来告诉他跑 `npm run dev`，不许自己起。
- 图标用 Lucide 风格内联 SVG（24 视口 / `stroke="currentColor"` / 1.75 / 圆头圆角），不用 emoji。
- 文案：按钮叫「放到工作区」/「在工作区 ✓」，一级按钮叫「工作区」，空桌那句是「桌上没东西。去看板或通讯录挑，抽屉头上按「放到工作区」。」
- 每个 task 只 `git add` 自己碰的文件。工作树里有他没提交的改动（App.jsx 里「同一个钟」那段、brain/timer.js、三条 migration），**不许一起提交，也不许改掉**。
- 注释风格跟仓库一致：中文，写「为什么」，不写「做了什么」。

---

### Task 1: 队列变桌子 —— `lib/queue.js` 收 org、退役「再等一等」

**Files:**
- Modify: `src/lib/queue.js`
- Test: `src/lib/queue.test.js`

**Interfaces:**
- Produces: `key(kind, id)` 接受 `'pursuit' | 'contact' | 'org'`（其它一律当 pursuit）；`parseKey(k)` 同样认三种；`normalize/enqueue` 的项只有 `{kind, id, via}`；新增 `select(q, k)` → 把光标放到 k 上（k 不在队里就原样返回）；删掉 `later`、`allSkipped`。

- [ ] **Step 1: 改测试**

`src/lib/queue.test.js` 里：
- import 行去掉 `later, allSkipped`，加 `select`。
- 删掉所有用到 `later` / `allSkipped` / `skipped` / `skippedAt` 的用例（第 31-33、56-72、95、110 行附近那几条）。
- 把第 91 行那条 normalize 用例改成：

```js
test('存坏了也读得回来 —— 非法项丢掉、重复的合并、旧存档里的 skipped 字段扔掉', () => {
  const got = normalize({
    items: [P('a'), null, P('a'), { nope: 1 }, { ...P('b'), skipped: 1, skippedAt: '2026-08-06' }],
    at: 'zzz',
  })
  assert.deepEqual(ids(got), [kp('a'), kp('b')])
  assert.deepEqual(Object.keys(got.items[1]).sort(), ['id', 'kind', 'via'])
  assert.equal(got.at, kp('a'))
})
```

- 加三条：

```js
const O = (id) => ({ kind: 'org', id })
const ko = (id) => key('org', id)

test('机构也能上桌 —— kind=org 认得出、拆得回', () => {
  const q = enqueue(EMPTY, [O('ZKM')])
  assert.equal(q.items[0].kind, 'org')
  assert.equal(keyOf(q.items[0]), 'org:ZKM')
  assert.deepEqual(parseKey('org:ZKM'), { kind: 'org', id: 'ZKM' })
})

test('select：把光标放到那一格上；不在桌上就不动', () => {
  const q = q3()
  assert.equal(select(q, kp('c')).at, kp('c'))
  assert.equal(select(q, kp('zzz')).at, kp('a'))
})

test('关掉当前那张 → 光标落到旁边一张；关掉最后一张 → 空桌', () => {
  let q = select(q3(), kp('b'))
  q = done(q, kp('b'));  assert.equal(q.at, kp('c'))
  q = done(q, kp('c'));  assert.equal(q.at, kp('a'))
  q = done(q, kp('a'));  assert.deepEqual(q, EMPTY)
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test src/lib/queue.test.js`
Expected: FAIL（`select` is not exported；org 被当成 pursuit）

- [ ] **Step 3: 改实现**

`src/lib/queue.js`：
- 文件头那段「队列是一份待办」的注释下面加一段：2026-09-02 起这摞就是**工作区的桌子**——每一项是一格开着的窗口；「再等一等」退役（窗口开着不动就是先放着），所以 skipped / skippedAt 不再存。
- `const KINDS = new Set(['pursuit', 'contact', 'org'])`；`key` / `parseKey` / `normalize` / `enqueue` 里所有 `x.kind === 'contact' ? 'contact' : 'pursuit'` 换成 `KINDS.has(x.kind) ? x.kind : 'pursuit'`。
- `normalize` / `enqueue` 生成的项只留 `{kind, id, via}`；`enqueue` 命中已有项时只更新 via。
- 删掉 `todayStr`、`later`、`allSkipped`、`liveAt`。
- `keepOrMove(items, q, k, i)` 改成：光标不是 k 且还在 → 不动；否则落到 `items[Math.min(i, items.length - 1)]`。
- 加：

```js
/** 把光标放到那一格上。不在桌上的格子点不着，原样返回。 */
export function select(q, k) {
  return q.items.some((x) => keyOf(x) === k) ? { ...q, at: k } : q
}
```

- [ ] **Step 4: 跑测试**

Run: `node --test src/lib/queue.test.js`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/queue.js src/lib/queue.test.js
git commit -m "队列就是桌子：机构能上桌，「再等一等」退役，加 select"
```

---

### Task 2: 地址栏 —— 带 d=1 是抽屉，不带就是桌上那张

**Files:**
- Modify: `src/lib/route.js`
- Test: `src/lib/route.test.js`

**Interfaces:**
- Produces: `toUrl(area, view)`：`area` 可为 `'desk'`；`view` 是 `{name:'pursuit', pursuit:{id}, mode}` / `{name:'person', person:{id}, mode}` / `{name:'org', org:{org}, mode}` / `{name:'home'}`；`mode === 'drawer'` 写 `d=1`，三种卡都写。`fromUrl(search)` → `{area, card}`，`card = {kind, id, drawer}`；**卡不带 d 时 `area` 一律是 `'desk'`**（不管 `?a=` 写的什么）。

- [ ] **Step 1: 改测试**

`src/lib/route.test.js`：
- 「名片：写得出也读得回」改成抽屉形态：

```js
test('名片抽屉：写得出也读得回', () => {
  const u = toUrl('people', { name: 'person', person: { id: 'abc' }, mode: 'drawer' }, P)
  assert.equal(u, '/?a=people&c=abc&d=1')
  assert.deepEqual(fromUrl('?a=people&c=abc&d=1'), { area: 'people', card: { kind: 'contact', id: 'abc', drawer: true } })
})
```

- 「机会线分整页和抽屉」改成：

```js
test('带 d=1 是某个区旁边的抽屉；不带就是桌上那张，主区一律 desk', () => {
  assert.equal(toUrl('desk', { name: 'pursuit', pursuit: { id: 'p1' } }, P), '/?p=p1')
  assert.equal(toUrl('pursue', { name: 'pursuit', pursuit: { id: 'p1' }, mode: 'drawer' }, P), '/?p=p1&d=1')
  assert.deepEqual(fromUrl('?p=p1'), { area: 'desk', card: { kind: 'pursuit', id: 'p1', drawer: false } })
  assert.deepEqual(fromUrl('?a=people&p=p1'), { area: 'desk', card: { kind: 'pursuit', id: 'p1', drawer: false } })
  assert.equal(fromUrl('?p=p1&d=1').area, null)   // 没写 a → 默认 pursue
})

test('空桌也有地址', () => {
  assert.equal(toUrl('desk', { name: 'home' }, P), '/?a=desk')
  assert.equal(fromUrl('?a=desk').area, 'desk')
})
```

- 「转一圈回来还是同一个地方」的 cases 换成：

```js
  const cases = [
    ['pursue', V.home], ['people', V.home], ['profile', V.home], ['desk', V.home],
    ['people', { name: 'person', person: { id: 'c1' }, mode: 'drawer' }],
    ['people', { name: 'org', org: { org: 'CultureHub' }, mode: 'drawer' }],
    ['pursue', { name: 'pursuit', pursuit: { id: 'p1' }, mode: 'drawer' }],
    ['desk', { name: 'pursuit', pursuit: { id: 'p1' } }],
    ['desk', { name: 'person', person: { id: 'c1' } }],
    ['desk', { name: 'org', org: { org: 'ZKM' } }],
  ]
```
（断言不变。）

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test src/lib/route.test.js`
Expected: FAIL

- [ ] **Step 3: 改实现**

`src/lib/route.js`：
- 头部约定注释改成：`?a=desk|people|profile|ledger`；`&d=1` = 那张卡是抽屉（旁边还有那个区的首页）；**不带 d 的卡一律在桌上，主区就是 desk**。
- `AREAS` 加 `'desk'`。
- `toUrl`：写卡的三段里都加 `if (view.mode === 'drawer') q.set('d', '1')`。
- `fromUrl`：`const drawer = q.get('d') === '1'`；三种 card 都带 `drawer`；最后 `return { area: card && !drawer ? 'desk' : area, card }`。

- [ ] **Step 4: 跑测试**

Run: `node --test src/lib/route.test.js`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/route.js src/lib/route.test.js
git commit -m "地址栏：带 d=1 是抽屉，不带就是桌上那张"
```

---

### Task 3: `lib/desk.js` —— 桌上每一格叫什么名字

**Files:**
- Create: `src/lib/desk.js`
- Test: `src/lib/desk.test.js`

**Interfaces:**
- Produces: `deskTabs(queue, { pursuits = [], contacts = [], orgs = [] })` → `[{ k, kind, id, name }]`，顺序同 `queue.items`；`name` 找不到（数据还没到 / 被删了）时为 `null`。`deskView(queue, data)` → 当前那格对应的 view 对象：`{name:'pursuit', pursuit}` / `{name:'person', person}` / `{name:'org', org}`，空桌或找不到返回 `{name:'home'}`。

- [ ] **Step 1: 写测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enqueue, EMPTY, select, key } from './queue.js'
import { deskTabs, deskView } from './desk.js'

const data = {
  pursuits: [{ id: 'p1', title: 'Kunstverein 申请' }],
  contacts: [{ id: 'c1', name: 'Maria Chen' }],
  orgs: [{ org: 'ZKM' }],
}
const q = enqueue(EMPTY, [
  { kind: 'pursuit', id: 'p1' }, { kind: 'contact', id: 'c1' }, { kind: 'org', id: 'ZKM' }, { kind: 'pursuit', id: 'gone' },
])

test('每一格按进桌顺序、带名字；找不到的名字是 null，格子不丢', () => {
  assert.deepEqual(deskTabs(q, data), [
    { k: 'pursuit:p1', kind: 'pursuit', id: 'p1', name: 'Kunstverein 申请' },
    { k: 'contact:c1', kind: 'contact', id: 'c1', name: 'Maria Chen' },
    { k: 'org:ZKM', kind: 'org', id: 'ZKM', name: 'ZKM' },
    { k: 'pursuit:gone', kind: 'pursuit', id: 'gone', name: null },
  ])
})

test('数据还没到也不炸', () => {
  assert.equal(deskTabs(q, {}).length, 4)
  assert.equal(deskTabs(q, {})[0].name, null)
})

test('deskView 给出当前那格的 view；空桌和找不到都是 home', () => {
  assert.deepEqual(deskView(select(q, key('contact', 'c1')), data), { name: 'person', person: data.contacts[0] })
  assert.deepEqual(deskView(select(q, key('org', 'ZKM')), data), { name: 'org', org: data.orgs[0] })
  assert.deepEqual(deskView(select(q, key('pursuit', 'gone')), data), { name: 'home' })
  assert.deepEqual(deskView(EMPTY, data), { name: 'home' })
})
```

- [ ] **Step 2: 跑，确认失败**

Run: `node --test src/lib/desk.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```js
// 桌上每一格是什么、叫什么。
//
// 队列（lib/queue.js）只存 {kind, id}——内容永远从库里读，这儿把名字对上。
// 名字对不上（数据还没到、卡被删了）不许把格子扔掉：那是「看不见 = 丢了」。
// 交给界面画个占位，×  照样能关。
import { keyOf, parseKey } from './queue.js'

const find = (kind, id, { pursuits = [], contacts = [], orgs = [] }) =>
  kind === 'pursuit' ? pursuits.find((p) => p.id === id)
  : kind === 'contact' ? contacts.find((c) => c.id === id)
  : orgs.find((o) => o.org === id)

const nameOf = (kind, hit) => (!hit ? null : kind === 'pursuit' ? hit.title : kind === 'contact' ? hit.name : hit.org)

export function deskTabs(q, data = {}) {
  return q.items.map((x) => {
    const { kind, id } = x
    return { k: keyOf(x), kind, id, name: nameOf(kind, find(kind, id, data)) }
  })
}

export function deskView(q, data = {}) {
  if (!q.at) return { name: 'home' }
  const { kind, id } = parseKey(q.at)
  const hit = find(kind, id, data)
  if (!hit) return { name: 'home' }
  return kind === 'pursuit' ? { name: 'pursuit', pursuit: hit }
    : kind === 'contact' ? { name: 'person', person: hit }
    : { name: 'org', org: hit }
}
```

- [ ] **Step 4: 跑测试**

Run: `npm test`
Expected: 全 PASS（含 Task 1、2）

- [ ] **Step 5: 提交**

```bash
git add src/lib/desk.js src/lib/desk.test.js
git commit -m "lib/desk：桌上每一格叫什么、当前那格是哪张"
```

---

### Task 4: 详情页头上的开关 —— 「放到工作区」/「在工作区 ✓」，过卡条退役

**Files:**
- Modify: `src/components/PursuitFocus.jsx:270-282, 740-785`
- Modify: `src/components/PersonFocus.jsx:74-80, 295-312`
- Modify: `src/components/OrgFocus.jsx:20, 40-46`
- Create: `src/components/DeskToggle.jsx`
- Delete: `src/components/QueueNav.jsx`
- Modify: `src/styles.css`（`.expand` 那三行、`.qnav*` 那几行）

**Interfaces:**
- Produces: 三个详情页统一的 props：`variant: 'page' | 'drawer'`、`onBack`、`onDesk: boolean`、`onToggleDesk()`。PursuitFocus 另保留 `via`（string | null，替代原来从 `queue.via` 读的那一项）。三者都不再收 `queue / onQueuePrev / onQueueNext / onQueueDone / onQueueLater / onExpand`。
- Consumes: 无。

- [ ] **Step 1: 写 `DeskToggle.jsx`**

```jsx
import React from 'react'

// 抽屉头上那颗开关：这张在不在桌上。
//
// 它替掉了「整页 →」。原来那颗是「带我去别处」，这颗是「记下：今天要弄它」，
// 人留在原地接着挑下一张——跟「加入购物车」一个道理。所以它得**当场翻面**：
// 按下去这颗变、顶栏数字变、看板上那张卡变，三处一起，你看得见东西去了哪。
// 图标：Lucide 的 layout-grid / check，内联 SVG，不引库。
export default function DeskToggle({ on, onToggle }) {
  return (
    <button
      type="button"
      className={'desktg' + (on ? ' on' : '')}
      aria-pressed={on}
      onClick={onToggle}
      title={on ? '在工作区里了。再按一下拿回来。' : '放到工作区——今天要弄它。你留在这儿接着挑。'}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
           strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {on
          ? <path d="M20 6 9 17l-5-5" />
          : <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
             <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>}
      </svg>
      {on ? '在工作区' : '放到工作区'}
    </button>
  )
}
```

- [ ] **Step 2: PursuitFocus 换头**

- props 行改成 `pursuit: p, messages, variant = 'page', onBack, onMove, onSetBall, onDesk = false, onToggleDesk, via = null,`。
- 删掉 `import QueueNav` 和第 748 行 `<QueueNav …/>` 及它上面那段注释；`viaUpdate` 原来怎么算的，把它的来源从 `queue?.via` 改成 `via`（grep `viaUpdate` 找到定义）。
- 第 771-783 行那段 `.ft-head` 改成：

```jsx
        <div className="ft-head">
          {inDrawer ? (
            <button className="back" onClick={onBack} aria-label="收起" title="收起"><span aria-hidden="true">✕</span><span className="t"> 收起</span></button>
          ) : (
            <button className="back" onClick={onBack}><span aria-hidden="true">←</span> 看板</button>
          )}
          <h1 className="ft-title" title={p.title}>{p.title}</h1>
          {/* 「整页 →」退役了。整页只在工作区里有，去工作区的路是这颗开关 + 顶栏那个字。 */}
          {inDrawer && <DeskToggle on={onDesk} onToggle={onToggleDesk} />}
        </div>
```

- 上面 import `DeskToggle from './DeskToggle.jsx'`。
- 文件顶部那段「两种装法」注释里的 `page ——` 一句改成：整页只在工作区里出现（桌上那格）。

- [ ] **Step 3: PersonFocus 换头**

- props 改成 `person, onBack, onChanged, onOpenPursuit, variant = 'page', onDesk = false, onToggleDesk,`；删掉 queue 四个 props 和那段注释；删 `import QueueNav`。
- 根节点 `className={'focus ' + variant}`。
- 第 300-311 行改成：

```jsx
        <div className="ft-head">
          {variant === 'drawer' ? (
            <button className="back" onClick={onBack} aria-label="收起" title="收起"><span aria-hidden="true">✕</span><span className="t"> 收起</span></button>
          ) : (
            <button className="back" onClick={onBack}><span aria-hidden="true">←</span><span className="t"> 通讯录</span></button>
          )}
          <h1 className="ft-title" title={veiled ? undefined : c.name}><Veil>{c.name || '未具名联系人'}</Veil></h1>
          {variant === 'drawer' && <DeskToggle on={onDesk} onToggle={onToggleDesk} />}
        </div>
```

- [ ] **Step 4: OrgFocus 换头**

- props：`{ org, onBack, onOpenPerson, onOpenPursuit, variant = 'page', onDesk = false, onToggleDesk }`；根节点 className 同上带 variant；第 42 行那颗 back 后面、标题后面加 `{variant === 'drawer' && <DeskToggle on={onDesk} onToggle={onToggleDesk} />}`，back 在 drawer 时也是 ✕ 收起。

- [ ] **Step 5: 样式**

`src/styles.css`：删 `.expand` 三行和 `.qnav`、`.qnav .qsp`、`.qnav.in-head*`、`.qarrow`、`.qcount`（grep `qnav\|qarrow\|qcount`）。加：

```css
/* 抽屉头上那颗「放到工作区」开关。翻面之后换色不换位——位置一动你就找不到它了。 */
.desktg { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 12px; font-weight: 600; color: var(--ink-2); background: transparent; border: 1px solid var(--line-2); border-radius: 999px; padding: 5px 11px; cursor: pointer; flex: none; }
.desktg:hover { color: var(--ink); border-color: var(--accent); }
.desktg.on { color: var(--accent); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
.desktg:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* 名片 / 机构塞进抽屉：三栏叠成一栏，各自不再单独滚，整个抽屉滚。 */
.focus.drawer .focus-cols { flex: 1; min-height: 0; overflow-y: auto; display: block; }
.focus.drawer .fc-l, .focus.drawer .fc-r { border: none; overflow: visible; padding: 14px 18px 0; }
```

- [ ] **Step 6: 删 QueueNav，确认没人再引用**

Run: `git rm src/components/QueueNav.jsx && grep -rn "QueueNav\|onExpand\|onQueue" src`
Expected: 只剩 App.jsx 里的引用（Task 5 处理）

- [ ] **Step 7: 提交**

```bash
git add src/components/PursuitFocus.jsx src/components/PersonFocus.jsx src/components/OrgFocus.jsx src/components/DeskToggle.jsx src/styles.css
git commit -m "详情页头上：「整页」和过卡条换成「放到工作区」开关"
```
（这一步之后 App.jsx 暂时对不上——Task 5 立刻接上。两步分开提交是为了回看时看得清哪一刀是哪一刀。）

---

### Task 5: App —— 工作区成为一级区，桌上那排窗口，带子撤掉

这是最大的一刀。`App.jsx` 里他有一段没提交的「同一个钟」改动（`FACTS_MS`、`tick`），**原样留着**。

**Files:**
- Modify: `src/App.jsx`
- Create: `src/components/DeskTabs.jsx`
- Create: `src/components/MailState.jsx`（从 `Subbar.jsx` 搬出来的那个函数，原样）
- Create: `src/components/PickBar.jsx`
- Delete: `src/components/Subbar.jsx`、`src/components/QueueRest.jsx`、`src/lib/filters.js`、`src/lib/filters.test.js`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 1 `select / done / enqueue / inQueue / key / parseKey`；Task 2 `toUrl / fromUrl`；Task 3 `deskTabs / deskView`；Task 4 三个详情页的新 props。
- Produces: `DeskTabs({ tabs, at, onPick, onClose })`；`PickBar({ picking, pickedCount, saying, onStart, onCancel, onSay, onPickAll, children })`——`children` 是不勾选时那几颗按钮。

- [ ] **Step 1: `MailState.jsx`**

把 `Subbar.jsx` 里 `function MailState` 连同它上面那段注释原样搬到 `src/components/MailState.jsx`，`export default`。

- [ ] **Step 2: `PickBar.jsx`**

```jsx
import React from 'react'

// 看板和通讯录头一行共用的那一段：平时是各自的动作按钮（children），
// 勾选时换成「已选 N · 说一句… · 过一遍 · 取消」。两边勾的是同一摞 picked，
// 所以这一段也只能是同一份——抄两遍迟早一边改了措辞另一边没改。
export default function PickBar({ picking, pickedCount, saying, onStart, onCancel, onSay, onPickAll, children }) {
  return (
    <div className="areabar">
      {picking && <span className="pickinfo">已选 {pickedCount} 张</span>}
      {saying && <span className="refreshing"><i className="spin" aria-hidden="true" />说给第 {saying.i}/{saying.n} 条</span>}
      <span className="sp" />
      {picking ? (
        <>
          <button className="wbtn" disabled={!pickedCount || Boolean(saying)} onClick={onSay}>说一句…</button>
          <button className="wbtn" disabled={!pickedCount} onClick={onPickAll}>过一遍</button>
          <button className="btn" onClick={onCancel}>取消</button>
        </>
      ) : (
        <>
          {children}
          <button className="wbtn" onClick={onStart}>批量操作</button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: `DeskTabs.jsx`**

```jsx
import React from 'react'
import Veil from './Veil.jsx'

// 工作区底下那一排：桌上开着的窗口。只在「工作区」亮着时渲染——
// 放在别的区底下，任何人都会当成那个区的分栏，可它混着线和人。
// 名字对不上（数据没到 / 卡被删了）画个占位，× 照样能关：格子不许因为名字丢了就消失。
export default function DeskTabs({ tabs, at, onPick, onClose }) {
  return (
    <div className="subbar desk-tabs" role="tablist" aria-label="桌上开着的">
      {tabs.map((t) => (
        <div key={t.k} className={'dtab' + (t.k === at ? ' on' : '')} role="presentation">
          <button type="button" role="tab" aria-selected={t.k === at} className="dtab-t" onClick={() => onPick(t.k)}>
            <span className={'dtab-k ' + t.kind} aria-hidden="true" />
            {t.name === null ? <em>…</em> : t.kind === 'pursuit' ? t.name : <Veil>{t.name}</Veil>}
          </button>
          <button type="button" className="dtab-x" aria-label="关掉" onClick={() => onClose(t.k)}>×</button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: App.jsx —— 状态和 import**

- import：删 `Subbar`、`QueueRest`、`filters.js` 那行；`queue.js` 那行改成 `{ loadQueue, saveQueue, normalize, enqueue, done as queueDone, select as queueSelect, inQueue, key as qKey, keyOf, parseKey }`；加 `DeskTabs`、`MailState`、`PickBar`、`{ deskTabs, deskView } from './lib/desk.js'`。
- `AREAS` 最前面加 `['desk', '工作区']`，注释：桌面；后面四个是架子。
- 删状态 `filters / setFilters`、`pplTab`、`tlTab`（连同注释）；`view` 的注释改成：**只表示某个区旁边开着的抽屉**，桌上看哪张由 `queue.at` 说了算。
- 删 `toggleFilter`、`shown`、`emptyNote`、`hiddenPicked`（`shown` 直接用 `pl.pursuits`）。
- 删 `openQueueCard`、`viewKey / atQueue / qItem / qInfo / resting / queueGo / finishCard / laterCard`、`expandPursuit`、`openInTab`。删「人这一层不进过卡队列」那段旧注释（已经不是事实）。
- 加：

```js
  // ── 桌子 ────────────────────────────────────────────────────
  // 队列（lib/queue.js）就是工作区的桌子。这儿只做三件事：放上去 / 拿下来 / 看哪格。
  const deskData = { pursuits: pl?.pursuits || [], contacts: ct?.contacts || [], orgs: ct?.orgs || [] }
  const onDeskKey = (k) => inQueue(queue, k)
  // 抽屉头上那颗开关。留在原地——它是「记下今天要弄它」，不是「带我去」。
  const toggleDesk = (kind, id) => {
    const k = qKey(kind, id)
    setQueue((q) => (inQueue(q, k) ? queueDone(q, k) : enqueue(q, [{ kind, id, via: 'pick' }])))
  }
  // 从桌上某一页点相关的人 / 线：直接开成旁边一格。
  const openOnDesk = (kind, id) => {
    setQueue((q) => queueSelect(enqueue(q, [{ kind, id, via: 'pick' }]), qKey(kind, id)))
    setArea('desk')
  }
  const drawerKey = view.name === 'pursuit' ? qKey('pursuit', view.pursuit.id)
    : view.name === 'person' ? qKey('contact', view.person.id)
    : view.name === 'org' ? qKey('org', view.org.org) : null
```

- `pickAll` 改成：

```js
  // 过一遍：勾的几张一起放上桌，然后过去——这颗按钮说的就是「开始过这一摞」。
  const pickAll = () => {
    const entries = [...picked].map((k) => ({ ...parseKey(k), via: 'pick' }))
    if (!entries.length) return
    const q = enqueue(queue, entries)
    setQueue(queueSelect(q, keyOf(entries[0])))
    cancelPick()
    setBellOpen(false)
    setArea('desk')
  }
```

- 抽屉的开法统一成三个：

```js
  const openPursuit = (p) => setView({ name: 'pursuit', pursuit: p, mode: 'drawer' })
  const openPerson = (c) => setView({ name: 'person', person: c, mode: 'drawer' })
  const openOrg = (o) => setView({ name: 'org', org: o, mode: 'drawer' })
  const closeDrawer = () => { if (view.name === 'pursuit') markSeen(view.pursuit.id); setView({ name: 'home' }) }
```
（原 `closePursuit` 改名 `closeDrawer`，所有调用跟着改。）

- [ ] **Step 5: App.jsx —— 地址栏、标签名、Esc**

- 恢复 effect（① 那段）：`fromUrl` 拿到 `{area: a, card}`：
  - `card.drawer` → 照原样：pursuit 进 pursue 区开抽屉；contact / org 进 people 区开抽屉（`openPerson` / `openOrg`）。
  - 不带 drawer → `setArea('desk')`；等对应数据到了之后 `setQueue((q) => queueSelect(enqueue(q, [{kind: card.kind, id: card.id, via:'pick'}]), qKey(card.kind, card.id)))`，其中 org 的 kind 是 `'org'`、id 是机构名；然后 `done()`。找不到那张也 `done()`（跟原来一样不许悬着），格子照样放上桌——名字会显示占位。
  - 没卡 → `if (a) setArea(a)`，done。
- 写地址的 effect（②）：`const cur = area === 'desk' ? deskView(queue, deskData) : view; const next = toUrl(area, cur)`；依赖加 `queue, pl, ct`。
- 标签名 effect（③）：先算 `const cur = area === 'desk' ? deskView(queue, deskData) : view`；然后 `cur.name === 'pursuit'` → 线名；`person` → 人名（veiled 照旧）；`org` → 机构；否则按 area：desk → '工作区'，其余照旧。抽屉不改名那段注释留着，逻辑改成「抽屉（`view.mode === 'drawer'`）不改名」：即 `area !== 'desk'` 时一律走 area 名。
- Esc：`else if (view.name !== 'home') closeDrawer()`。

- [ ] **Step 6: App.jsx —— 渲染**

顶栏 `header.app-top`：`nav.areas` 里的按钮文字改成
```jsx
{label}{key === 'desk' && queue.items.length > 0 && <span className="area-n"> · {queue.items.length}</span>}
```
点一级按钮：`onClick={() => { setArea(key); if (view.name !== 'home') closeDrawer() }}`（不变）。
`<span className="sp" />` 之后、`veilbtn` 之前插入 `<MailState state={brain?.mail} />` 和原来那颗 `bellbtn`（整段搬过来，含 SVG）。

删掉整个 `<div className="subbar">…</div>`，换成：
```jsx
      {area === 'desk' && (
        <DeskTabs tabs={deskTabs(queue, deskData)} at={queue.at}
                  onPick={(k) => setQueue((q) => queueSelect(q, k))}
                  onClose={(k) => setQueue((q) => queueDone(q, k))} />
      )}
```

内容区改成按 area 分五路：

```jsx
      {area === 'desk' ? (
        (() => {
          const cur = deskView(queue, deskData)
          if (!queue.items.length) return <div className="desk-empty">桌上没东西。去看板或通讯录挑，抽屉头上按「放到工作区」。</div>
          if (cur.name === 'home') return <div className="desk-empty">这一格对应的东西找不到了——库里没有它。关掉它就行。</div>
          if (cur.name === 'pursuit') return (
            <PursuitFocus key={cur.pursuit.id} variant="page" pursuit={cur.pursuit}
              messages={pl.messagesByPursuit[cur.pursuit.id]}
              via={queue.items.find((x) => keyOf(x) === queue.at)?.via || null}
              onOpenPerson={(c) => openOnDesk('contact', c.id)}
              onBack={() => setArea('pursue')} onMove={moveCard} onSetBall={markBall} />
          )
          if (cur.name === 'person') return (
            <PersonFocus key={cur.person.id} person={cur.person} variant="page"
              onBack={() => setArea('people')} onChanged={reloadContacts}
              onOpenPursuit={(id) => openOnDesk('pursuit', id)} />
          )
          return (
            <OrgFocus key={cur.org.org} org={cur.org} variant="page"
              onBack={() => setArea('people')}
              onOpenPerson={(id) => openOnDesk('contact', id)}
              onOpenPursuit={(id) => openOnDesk('pursuit', id)} />
          )
        })()
      ) : area === 'people' ? (
        <>
          <PickBar picking={picking} pickedCount={picked.size} saying={saying}
                   onStart={() => setPicking(true)} onCancel={cancelPick}
                   onSay={() => setSayOpen(true)} onPickAll={pickAll}>
            <button className="wbtn" onClick={() => setAddOpen(true)}>＋ 新联系人</button>
          </PickBar>
          <People … 原 props，去掉 tab，onOpen={(c) => openPerson(c)} onOpenOrg={(o) => openOrg(o)}
                  desk={new Set(queue.items.map(keyOf))} />
        </>
      ) : area === 'profile' ? ( …不变… )
      : area === 'ledger' ? ( <Timeline …去掉 tab prop… onOpen={(r) => r.subject_kind === 'pursuit'
            ? (() => { const p = pl.pursuits.find((x) => x.id === r.subject_id); if (p) { setArea('pursue'); openPursuit(p) } })()
            : (() => { const c = ct?.contacts?.find((x) => x.id === r.subject_id); if (c) { setArea('people'); openPerson(c) } })()} /> )
      : (
        <>
          <PickBar …同上…>
            <button className="wbtn" onClick={() => setTasksOpen(true)}>造卡任务</button>
          </PickBar>
          <Pipeline pursuits={pl.pursuits} tasks={tk.tasks} states={…} audit={audit}
            onOpen={openPursuit} onMove={moveCard} onJot={jotCard} unseen={unseen}
            picking={picking} picked={picked} onPick={pick}
            desk={new Set(queue.items.map(keyOf))} />
          {audit && <button className="audit-off" onClick={() => setAudit(false)}>收起气泡</button>}
        </>
      )}
```

抽屉从看板那一支里拿出来，放到内容区之后、`SayTo` 之前，**pursue 和 people 两个区共用**：

```jsx
      {(area === 'pursue' || area === 'people') && view.name !== 'home' && (
        <aside className="drawer" aria-label={view.name === 'pursuit' ? view.pursuit.title : view.name === 'person' ? '名片' : view.org.org}>
          <DrawerGrip />
          {view.name === 'pursuit' ? (
            <PursuitFocus key={view.pursuit.id} variant="drawer" pursuit={openedPursuit}
              messages={pl.messagesByPursuit[view.pursuit.id]}
              onOpenPerson={(c) => { setArea('people'); openPerson(c) }}
              onBack={closeDrawer} onMove={moveCard} onSetBall={markBall}
              onDesk={onDeskKey(drawerKey)} onToggleDesk={() => toggleDesk('pursuit', view.pursuit.id)} />
          ) : view.name === 'person' ? (
            <PersonFocus key={view.person.id} variant="drawer" person={openedPerson}
              onBack={closeDrawer} onChanged={reloadContacts}
              onOpenPursuit={(id) => { const p = pl.pursuits.find((x) => x.id === id); if (p) { setArea('pursue'); openPursuit(p) } }}
              onDesk={onDeskKey(drawerKey)} onToggleDesk={() => toggleDesk('contact', view.person.id)} />
          ) : (
            <OrgFocus key={view.org.org} variant="drawer" org={ct?.orgs?.find((o) => o.org === view.org.org) || view.org}
              onBack={closeDrawer}
              onOpenPerson={(id) => { const c = ct?.contacts?.find((x) => x.id === id); if (c) openPerson(c) }}
              onOpenPursuit={(id) => { const p = pl.pursuits.find((x) => x.id === id); if (p) { setArea('pursue'); openPursuit(p) } }}
              onDesk={onDeskKey(drawerKey)} onToggleDesk={() => toggleDesk('org', view.org.org)} />
          )}
        </aside>
      )}
```

`drawered` 改成 `const drawered = (area === 'pursue' || area === 'people') && view.name !== 'home'`；`onPursuit / paged / openedPursuit` 相应简化（`openedPursuit` 只在 `view.name === 'pursuit'` 时算）。`unseen` 里「当前正开着的那张不算」改成看 `view`（抽屉）或 `queue.at`（桌上）。

通知面板 `onOpen`：pursuit → `setArea('pursue'); openPursuit(p)`；contact → `setArea('people'); openPerson(c)`。

- [ ] **Step 7: Pipeline / People 接 `desk` 记号**

`Pipeline.jsx`：props 加 `desk = new Set()`；`Stack` 和 `PCard` 一路传下去；`PCard` 里 `pc-badge` 那行之后加
```jsx
      {onDesk && <span className="pc-desk" aria-label="在工作区">在工作区</span>}
```
（`onDesk={desk.has(qKey('pursuit', p.id))}`。）
`People.jsx`：props 去掉 `tab`，`shown = found || entries`；加 `desk = new Set()`；卡片里 `k` 那个键已经有了（`qKey`），在名字旁加同一个 `<span className="pc-desk">在工作区</span>`（`desk.has(k)`；机构的 k 用 `qKey('org', e.o.org)`）。

- [ ] **Step 8: Timeline 自己的头上放日历 / 流水**

`Timeline.jsx`：props 去掉 `tab`，改成 `const [tab, setTab] = useState('cal')`；`page-head` 里 `<h1>` 之后加：
```jsx
          <div className="tabs" role="group" aria-label="看哪一半">
            {[['cal', '日历'], ['flow', '流水']].map(([k, label]) => (
              <button key={k} type="button" className={'tab' + (tab === k ? ' on' : '')}
                      aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
```
注释：两半都得看得见；切换从导航带子搬进页里，因为它不是「去哪儿」，是「看哪一半」。

- [ ] **Step 9: 样式**

`src/styles.css`：
- 删 `.wrap.drawered .subbar` 那条，加 `.wrap.drawered .app-top { padding-right: calc(var(--drawer-w) + 24px); }`（注释：抽屉顶到窗口最上沿，🔔 现在在顶栏，得让位）。
- 删 `.subbar .bellbtn { margin-left: auto }`、`.qbtn`、`.qpile`、`.qrest*`、`.barname`。
- 加：

```css
.area-n { font-weight: 500; color: var(--ink-3); }
.area.on .area-n { color: var(--accent); }
.app-top .mailst { flex: none; }

/* 各区自己的头一行：动作跟着它作用的东西走，不再站在导航带子上 */
.areabar { display: flex; align-items: center; gap: 12px; padding: 9px 22px; border-bottom: 1px solid var(--line); flex: none; }
.areabar .sp { flex: 1; }
.wrap.drawered .areabar { padding-right: calc(var(--drawer-w) + 24px); }

/* 桌上那排窗口。横向滚，格子不缩——看不见题目等于没开。 */
.desk-tabs { flex-wrap: nowrap; overflow-x: auto; gap: 4px; padding: 7px 18px; }
.dtab { display: inline-flex; align-items: center; flex: none; border: 1px solid transparent; border-radius: 9px; }
.dtab.on { background: var(--paper-2); border-color: var(--line-2); }
.dtab-t { font: inherit; font-size: 12.5px; color: var(--ink-3); background: none; border: 0; padding: 6px 4px 6px 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dtab.on .dtab-t { color: var(--ink); font-weight: 600; }
.dtab-t em { font-style: normal; color: var(--ink-3); }
.dtab-k { width: 7px; height: 7px; border-radius: 2px; background: var(--line-2); flex: none; }
.dtab-k.pursuit { background: var(--accent); }
.dtab-k.contact { border-radius: 50%; background: var(--g2); }
.dtab-x { font: inherit; font-size: 14px; line-height: 1; color: var(--ink-3); background: none; border: 0; padding: 4px 8px 4px 2px; cursor: pointer; border-radius: 6px; }
.dtab-x:hover { color: var(--ink); }
.desk-empty { padding: 60px 26px; color: var(--ink-3); font-family: var(--serif); font-size: 14px; }

/* 卡角上的记号：这张今天挑了。跟顶栏数字、抽屉那颗开关一起翻面。 */
.pc-desk { display: inline-block; font-size: 10px; font-weight: 600; line-height: 1; padding: 3px 6px; margin-left: 6px; border-radius: 5px; color: var(--accent); background: var(--accent-soft); vertical-align: 2px; }
```

- [ ] **Step 10: 删死文件，跑测试和构建**

```bash
git rm src/components/Subbar.jsx src/components/QueueRest.jsx src/lib/filters.js src/lib/filters.test.js
grep -rn "Subbar\|QueueRest\|filters.js\|applyFilters\|tlTab\|pplTab\|openInTab\|expandPursuit\|QueueNav" src
npm test && npm run build
```
Expected：grep 空；测试全 PASS；build 成功。

- [ ] **Step 11: 提交**

```bash
git add src/App.jsx src/components/DeskTabs.jsx src/components/MailState.jsx src/components/PickBar.jsx src/components/Pipeline.jsx src/components/People.jsx src/components/Timeline.jsx src/styles.css
git commit -m "工作区：桌面和架子。二级带子只装桌上开着的窗口，过卡队列并进来"
```
**注意**：`git add src/App.jsx` 会把他那段「同一个钟」一起带进去。做法：先 `git add -p src/App.jsx`，把 `FACTS_MS` / `tick` 那三块跳过（`n`），其余 `y`。`Timeline.jsx` 里他加的 `tick` prop 那两行同理跳过。提交前 `git diff --cached --stat` 确认没带上 brain/ 和 migrations。

---

### Task 6: 在真页面上过一遍验收单

**Files:** 无改动（有的话回到对应 task 修）。

- [ ] **Step 1: 看 dev server 在不在**

Run: `lsof -iTCP -sTCP:LISTEN -P | grep -i node`
不在 → 停下，告诉他：`npm run dev`（不许自己起）。

- [ ] **Step 2: 用 Playwright MCP 按稿子「怎么验收」1-9 逐条走**

每条截一张图存到 scratchpad。特别看：
- 抽屉里的名片（PersonFocus variant=drawer）三栏叠成一栏之后能不能读；
- 桌上七格时那一排横向滚、名字没被缩没；
- 开着抽屉时顶栏的 🔔 没被抽屉盖住；
- 刷新之后地址栏和桌子都还在。

- [ ] **Step 3: 把截图给他看**

用 SendUserFile 发关键的三四张：顶栏 + 空桌、抽屉开关翻面前后、工作区四格、名片抽屉。

---

## 名词表

| 代码里的名字 | 意思 |
|---|---|
| `queue` / `pa_queue` | 桌子。本地存的那摞「今天要弄的」，原来叫过卡队列 |
| `queue.at` | 桌上正看着哪一格 |
| `area === 'desk'` | 一级导航亮着「工作区」 |
| `view` | 某个区旁边开着的抽屉（线 / 人 / 机构），`{name:'home'}` = 没开 |
| `deskTabs / deskView` | 桌上每格叫什么 / 当前那格是哪张（lib/desk.js） |
| `DeskToggle` | 抽屉头上「放到工作区 / 在工作区 ✓」那颗开关 |
| `PickBar` | 看板和通讯录头一行（批量操作那一套） |
| `d=1` | 地址栏里「这张是抽屉」；不带 = 在桌上 |
