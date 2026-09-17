# 档案里的一张书桌 · 施工计划

> **给施工的人**：一步一步做，每步做完打勾。测试先写、看它红了、再写实现、看它绿了、提交。

**目标**：在「我的档案」每一栏右边支一个 chat——带着全部档案和你展开着的那几条，
能上网找 reference、能开作品的图看，**但一台写库的工具都没有**。

**做法**：沿用现有那套聊天管线（`/chat/stream` + SSE + 「重说」），只在
`ownerOf()` 上加第三种主人 `studio`。对话进一张新表，不碰 `pursuit_messages`。

**栈**：Vite + React 18 · Supabase（`producer` schema）· brain sidecar（Node + Claude Agent SDK）

**设计稿**：[`docs/specs/2026-09-11-a-desk-in-the-archive-design.md`](../specs/2026-09-11-a-desk-in-the-archive-design.md)

## 全局约束

- **它不写库。** 桌子这边不给任何写库的工具，只给 `WebSearch` / `WebFetch` +
  新造的 `open_work_image`。
- **`draft` 默认 `false`**（= 写完的）。现有条目一条都不许从 Fairwind 眼前消失。
- **`draft` 只对 AI 隐形，档案页照常显示全部。**
- **迁移里 `create or replace function` 必须整段重写**，不能只写差异——漏掉
  `security definer` / `set search_path` 会悄悄改权限模型且不报错。
- **名字用 `studio` 不用 `desk`**：`desk` 已被「展开的卡片」工作区占用。
- 测试命令：`npm test`（跑 `src/lib/*.test.js` `brain/*.test.js` `brain/mail/*.test.js`）。
- **不许自己起 dev server。** 要看效果时把命令告诉他，他自己在终端起。

---

## 文件清单

| 文件 | 职责 |
|---|---|
| `supabase/migrations/0127_a_desk_in_the_archive.sql` | 建表、加列、五支 RPC、`pa_brain_context` 补字段 |
| `brain/studio.js` | 桌子那版的人格和 prompt 拼装（**纯函数**，可测） |
| `brain/studio.test.js` | 上面那支的测试 |
| `brain/prompt.js` | `entriesBlock()` 滤掉 `draft` |
| `brain/prompt.test.js` | 补一条滤 draft 的测试 |
| `brain/server.js` | `ownerOf` 第三种 + `loadStudioContext` + `addMessage` 分岔 + `handleChat` 分岔 + `worksServer` |
| `src/lib/studio.js` | 前端：读这一栏的对话 / 「重说」 / 切 draft / 加一条 |
| `src/lib/studio.test.js` | 上面那支里纯函数部分的测试 |
| `src/lib/chat.js` | `ownerBody()` 认 `{kind:'studio', id:section}` |
| `src/lib/chat.test.js` | 新建：`ownerBody` 三种主人的测试 |
| `src/components/Thread.jsx` | 从 `PursuitFocus` 抽出来的消息渲染，两边共用 |
| `src/components/StudioChat.jsx` | 右栏那个聊天 |
| `src/components/Library.jsx` | 三栏 + 焦点 + 「加一条」+ draft chip |
| `src/styles.css` | 三栏布局 |

---

### Task 1：迁移

**Files:**
- Create: `supabase/migrations/0127_a_desk_in_the_archive.sql`

**Interfaces:**
- Produces: `producer.studio_messages` 表；`producer.works.draft` 列；
  `pa_studio_thread(text)` / `pa_rewind_studio(uuid)` / `pa_set_entry_draft(uuid, boolean)` /
  `pa_add_entry(text, text)` / `pa_add_studio_message(text, text, text, text, jsonb)`；
  `v_pa_entries` 多一列 `draft`；`pa_brain_context` 的 entries 多 `id` / `images`。

- [ ] **Step 1：照着 [0066](../../supabase/migrations/0066_say_it_again.sql) 和
  [0009](../../supabase/migrations/0009_brain_rpc.sql) 的写法写整支迁移**

开头一段注释说清楚「为什么是新表」（护栏 `pm_owner_chk` 那条理由）。

建表：

```sql
create table if not exists producer.studio_messages (
  id          uuid primary key default gen_random_uuid(),
  section     text not null,
  role        text not null,
  kind        text not null default 'message',
  content     text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists studio_messages_sec_idx
  on producer.studio_messages (section, created_at) where deleted_at is null;
```

加列 + 视图补列（`v_pa_entries` 要 `create or replace view`，整段重写，
列顺序保持原样、`draft` 加在 `tags` 后面）：

```sql
alter table producer.works add column if not exists draft boolean not null default false;
```

五支 RPC，全部 `security definer` + `set search_path = public, producer`：

- `pa_studio_thread(p_section text) returns jsonb` —— `jsonb_agg` 这一栏
  `deleted_at is null` 的消息，按 `created_at`。空的返回 `'[]'::jsonb`。
  grant 给 `anon, authenticated, service_role`。
- `pa_rewind_studio(p_msg_id uuid) returns int` —— 照抄 0066：
  先拿到那条的 `section` 和 `created_at`，把同一 `section` 下 `created_at >=` 它的
  且 `deleted_at is null` 的全部打上 `now()`，返回行数。grant anon。
- `pa_set_entry_draft(p_id uuid, p_draft boolean) returns void` —— grant anon。
- `pa_add_entry(p_kind text, p_title text) returns uuid` —— `insert into producer.works
  (kind, title, draft, source, sort) values (p_kind, p_title, true, 'manual',
  coalesce((select max(sort) from producer.works), 0) + 1) returning id`。
  `p_title` 空白时用 `'（未命名）'`。grant anon。
- `pa_add_studio_message(p_section text, p_role text, p_content text,
  p_kind text default 'message', p_meta jsonb default null) returns jsonb` ——
  role 只能是 `artist|producer|system`，否则 `raise exception`；content 空白也 raise。
  返回整行 `to_jsonb`。**只 grant `service_role`**（`revoke all ... from public, anon,
  authenticated` 写在前面）。

最后整段重写 `pa_brain_context`：把 0025 那一版原样抄过来，在 entries 的
`jsonb_build_object` 里加 `'id', e.id,` 和 `'images', e.images,`，并加
`where not e.draft`。**权限那两行（revoke / grant service_role）跟着抄。**

- [ ] **Step 2：语法自查**

Run: `grep -c "security definer" supabase/migrations/0127_a_desk_in_the_archive.sql`
Expected: `6`（五支新 RPC + 重写的 `pa_brain_context`）

- [ ] **Step 3：提交**

```bash
git add supabase/migrations/0127_a_desk_in_the_archive.sql
git commit -m "档案里支一张书桌：新表 studio_messages、draft 一列、加条目一支（0127）"
```

> 应用到远端：用 Supabase MCP 的 `apply_migration`。**这一步要先问他**——
> 那是真库。

---

### Task 2：`entriesBlock()` 滤掉 draft

**Files:**
- Modify: `brain/prompt.js`（`entriesBlock`）
- Test: `brain/prompt.test.js`

**Interfaces:**
- Consumes: 条目对象上多了 `draft` 字段（Task 1）
- Produces: `entriesBlock(entries)` 跳过 `draft === true` 的

- [ ] **Step 1：写红的测试**

```js
test('entriesBlock：在写的条目不进 prompt', () => {
  const es = [
    { kind: 'work', title: '写完的' },
    { kind: 'work', title: '还在写的', draft: true },
  ]
  const out = entriesBlock(es).join('\n')
  assert.match(out, /写完的/)
  assert.doesNotMatch(out, /还在写的/)
})

test('entriesBlock：全是在写的就整块不出现', () => {
  assert.deepEqual(entriesBlock([{ kind: 'work', title: 'x', draft: true }]), [])
})
```

- [ ] **Step 2：跑，确认红**

Run: `node --test brain/prompt.test.js`
Expected: FAIL —— 「还在写的」出现在输出里

- [ ] **Step 3：实现**

`entriesBlock` 开头改成：

```js
export function entriesBlock(all) {
  // 「在写」的不进 prompt：没写完的东西不该被当成战绩用在一封真的申请里。
  // 只对 Fairwind 隐形——档案页照常显示全部。
  const entries = all.filter((e) => !e.draft)
  if (!entries.length) return []
  ...
```

- [ ] **Step 4：跑，确认绿（连带老测试）**

Run: `node --test brain/prompt.test.js`
Expected: PASS，一条都不许红

- [ ] **Step 5：提交**

```bash
git add brain/prompt.js brain/prompt.test.js
git commit -m "没写完的东西不进 prompt"
```

---

### Task 3：`brain/studio.js` —— 桌子那版 prompt

**Files:**
- Create: `brain/studio.js`
- Test: `brain/studio.test.js`

**Interfaces:**
- Consumes: `systemFor` 之外自立门户；复用 `entriesBlock`（Task 2）和
  `profileBlock` 的写法（`prompt.js` 里 `profileBlock` 没导出，在 studio.js 里
  照写一份三行的，不去动 prompt.js 的导出面）
- Produces:
  - `STUDIO_SYSTEM(profile) -> string`
  - `focusBlock({ label, count, open }) -> string[]`　`open` 是 `[{id, title}]`
  - `studioParts(ctx, incoming, exceptId) -> { fixed, talk }`
  - `buildStudioSystem(ctx) -> [静态, BOUNDARY, 动态]`
  - `buildStudioUser(ctx, incoming, exceptId) -> string`
  - `ctx` 形状：`{ entries, profile, msgs, focus }`，`focus` = `{ label, count, open }`

- [ ] **Step 1：写红的测试**

```js
import { test } from 'node:test'
import assert from 'node:assert'
import { STUDIO_SYSTEM, focusBlock, buildStudioSystem, buildStudioUser } from './studio.js'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk'

const CTX = {
  profile: { name: 'Hu Di', website: 'https://hudiworks.com' },
  entries: [{ kind: 'work', title: '花园', body: '一段描述' }],
  msgs: [],
  focus: { label: '作品', count: 11, open: [{ id: 'abc', title: '花园' }] },
}

test('人格里写死「你改不了他的档案」', () => {
  const s = STUDIO_SYSTEM(CTX.profile)
  assert.match(s, /你不动他的档案|你改不了/)
})

test('人格里不带写信、填表、状态机那三条规矩', () => {
  const s = STUDIO_SYSTEM(CTX.profile)
  assert.doesNotMatch(s, /\[\[LETTER\]\]/)
  assert.doesNotMatch(s, /\[\[FORM\]\]/)
  assert.doesNotMatch(s, /\[\[STATE\]\]/)
})

test('焦点：展开着的条目带 id 列出来', () => {
  const out = focusBlock(CTX.focus).join('\n')
  assert.match(out, /作品/)
  assert.match(out, /11/)
  assert.match(out, /花园/)
  assert.match(out, /abc/)
})

test('焦点：一条没展开就只说栏，不留空列表', () => {
  const out = focusBlock({ label: '自述', count: 2, open: [] }).join('\n')
  assert.match(out, /自述/)
  assert.doesNotMatch(out, /展开着/)
})

test('信息库在静态块里，焦点在 user message 里', () => {
  const [静, 界, 动] = buildStudioSystem(CTX)
  assert.equal(界, SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  assert.match(静, /花园/)            // 信息库进静态块
  assert.doesNotMatch(静, /abc/)      // 焦点不进静态块，不然每栏一个缓存前缀
  const u = buildStudioUser(CTX, '这段不准', null)
  assert.match(u, /abc/)
  assert.match(u, /这段不准/)
})

test('往来里把刚落库的那句摘出去，不重复出现两遍', () => {
  const ctx = { ...CTX, msgs: [{ id: 'm1', role: 'artist', content: '这段不准' }] }
  const u = buildStudioUser(ctx, '这段不准', 'm1')
  assert.equal(u.match(/这段不准/g).length, 1)
})
```

- [ ] **Step 2：跑，确认红**

Run: `node --test brain/studio.test.js`
Expected: FAIL —— `Cannot find module './studio.js'`

- [ ] **Step 3：实现 `brain/studio.js`**

开头一段注释讲清楚这支跟 `prompt.js` 的关系（同一个 Fairwind，换一张桌子；
**纯函数，不碰库不碰网**，所以测得了）。

`STUDIO_SYSTEM(profile)` 按设计稿 4.4 那五条写。要点，一条都不能少：

- 你的活：陪他把**他自己的东西**说准。
- **你不动他的档案。** 你写的每个字都是给他看的稿子，进不进档案是他自己复制过去、
  自己改的。所以别说「我帮你改好了」——你改不了。
- 出稿就出完整能用的整段，别只给意见。
- **别替他找腔调。** 他的话已经在档案里了，往那个方向靠，不是往「艺术家陈述
  该有的样子」靠。
- 一次一件。
- 查了东西要说清是从哪儿来的，别把别人网页上的话直接当成他的话写出来。
- 看图那台工具怎么用（克制，要判断画里的东西才开）。

`focusBlock({ label, count, open })`：

```js
export function focusBlock(f) {
  if (!f?.label) return []
  const lines = ['## 他现在在写哪个', `他开着「${f.label}」这一栏（${f.count} 条）。`]
  if (f.open?.length) {
    lines.push('展开着：')
    for (const e of f.open) lines.push(`- 《${e.title}》（id ${e.id}）`)
    lines.push('他多半就在说这几条。指哪一条时把 id 说出来，他好对上。')
  }
  lines.push('')
  return lines
}
```

`studioParts` / `buildStudioSystem` / `buildStudioUser` 照 `prompt.js` 里
`promptParts` / `buildSystem` / `buildUser` 的形状写，只是 `perLine` 恒为空
（桌子这边没有「每条线不同」的东西），`talk` = 往来 + 焦点 + 他刚说的那句。

- [ ] **Step 4：跑，确认绿**

Run: `node --test brain/studio.test.js`
Expected: PASS，6 条全绿

- [ ] **Step 5：提交**

```bash
git add brain/studio.js brain/studio.test.js
git commit -m "桌子那版人格：陪你写，但你改不了他的档案"
```

---

### Task 4：brain 接上第三种主人

**Files:**
- Modify: `brain/server.js`（`ownerOf` / `addMessage` / `loadOwnerContext` / `handleChat`）

**Interfaces:**
- Consumes: Task 1 的 `pa_studio_context`（**注意：Task 1 没建这支**，见下面 Step 1）、
  `pa_add_studio_message`；Task 3 的 `buildStudioSystem` / `buildStudioUser`
- Produces: `POST /chat` 和 `/chat/stream` 收 `{ section, focus, text }`

- [ ] **Step 1：把 `pa_studio_context` 补进 0127**

Task 1 漏了这支（`pa_brain_context` 要 `p_pursuit_id`，桌子这边没有线）。
现在补进同一支迁移文件：

```sql
create or replace function public.pa_studio_context(p_section text)
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at)
      from producer.studio_messages m
      where m.section = p_section and m.deleted_at is null
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'title', e.title, 'body', e.body,
        'concern', e.concern, 'year', e.year, 'medium', e.medium,
        'site_path', e.site_path, 'box', e.box, 'meta', e.meta,
        'tags', e.tags, 'images', e.images
      ) order by e.kind, e.sort)
      from producer.works e where not e.draft
    ), '[]'::jsonb),
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1)
  );
$$;
revoke all on function public.pa_studio_context(text) from public, anon, authenticated;
grant execute on function public.pa_studio_context(text) to service_role;
```

（`security definer` 的自查数字因此变成 `7`。）

- [ ] **Step 2：`ownerOf` 加第三种**

```js
function ownerOf(body) {
  if (body?.contact_id) return { kind: 'contact', id: body.contact_id }
  if (body?.pursuit_id) return { kind: 'pursuit', id: body.pursuit_id }
  // 第三种主人：档案里的一张书桌。id 是「哪一栏」，不是 uuid。
  if (body?.section) return { kind: 'studio', id: body.section }
  return null
}
```

错误话术也改：`'要有 pursuit_id / contact_id / section，外加 text'`。

- [ ] **Step 3：`addMessage` 和 `loadOwnerContext` 各加一岔**

```js
// addMessage 里
o.kind === 'studio' ? 'pa_add_studio_message'
  : o.kind === 'contact' ? 'pa_add_contact_message' : 'pa_add_message'
// 参数
...(o.kind === 'studio' ? { p_section: o.id } : ...)
```

```js
async function loadStudioContext(section, focus) {
  const { data, error } = await db.rpc('pa_studio_context', { p_section: section })
  if (error) throw new Error('读上下文失败：' + error.message)
  return {
    kind: 'studio',
    msgs: data.messages || [],
    entries: data.entries || [],
    profile: data.profile || null,
    focus: focus || null,
    raw: data,
  }
}
```

`loadOwnerContext` 多一岔，签名多收一个 `focus`。

- [ ] **Step 4：`handleChat` 分岔**

桌子这条路跟机会线**共用前半截**（先落库你的话、`onEvent('mine')`、
起 AbortController、终止的处理），从「拼 prompt」起分开：

```js
const isStudio = owner.kind === 'studio'
...
;({ text: reply, usage, notes, recovered } = await think(
  isStudio ? buildStudioUser(ctx, text.trim(), mine.id) : buildUser(ctx, text.trim(), mine.id),
  tools,
  isStudio ? buildStudioSystem(ctx) : buildSystem(ctx),
  ac, servers, onEvent,
))
```

**信封那一整段（`extractLetter` / `extractForm` / `peelEnvelopes` /
`applyStateMove` / `applyMemo`）桌子这边整段跳过**——它不写信、不填表、
不动状态机，人格里也没教它那几行标记。跳过是因为**万一它学别处的样子吐了一行
`[[STATE]]`，那行不该真的去动谁的卡**。

```js
if (isStudio) {
  const theirs = await addMessage(owner, 'producer', reply, 'message',
    notes?.length || recovered ? { ...(notes?.length ? { notes } : {}),
                                   ...(recovered ? { recovered: true } : {}) } : null)
  return { mine, reply: theirs }
}
```

- [ ] **Step 5：工具那一岔（图）**

在 `filesServer` 下面加一支 `worksServer(entries)`：

```js
const WORK_IMG_TOOL = 'mcp__studio_works__open_work_image'

// 跟 filesServer 是同一套：护栏长在闭包里，不在提示词里。能开的图写死成
// 这一栏传进来的这些条目的 images，别的够不到。
function worksServer(entries) {
  const withImg = entries.filter((e) => e.images?.length)
  const find = (name) => {
    const n = (name || '').trim().toLowerCase()
    return withImg.find((e) => (e.title || '').toLowerCase() === n)
      || withImg.find((e) => (e.title || '').toLowerCase().includes(n))
  }
  const budget = imageBudget()
  return createSdkMcpServer({
    name: 'studio_works',
    tools: [tool('open_work_image', `看一眼某件作品长什么样。...一条对话最多 ${IMG_CAP} 张。`,
      { title: z.string().describe('作品标题（写个能认出来的片段也行）'),
        index: z.number().optional().describe('第几张，默认第一张') },
      async ({ title, index }) => {
        const e = find(title)
        if (!e) {
          const list = withImg.map((x) => x.title).join('、') || '（这一栏没有带图的条目）'
          return { content: [{ type: 'text', text: `没有叫「${title}」的带图条目。这一栏有图的是：${list}` }] }
        }
        const url = e.images[(index || 1) - 1]
        if (!url) return { content: [{ type: 'text', text: `《${e.title}》只有 ${e.images.length} 张图。` }] }
        const pass = budget.admit(`${e.title}#${index || 1}`)
        if (!pass.ok) return { content: [{ type: 'text', text: pass.why }] }
        try {
          const r = await fetch(url)
          if (!r.ok) throw new Error(`取不回来（HTTP ${r.status}）`)
          const buf = Buffer.from(await r.arrayBuffer())
          const got = await read(buf, url.split('/').pop() || 'image', r.headers.get('content-type'))
          if (got.kind !== 'image') throw new Error('这个地址取回来的不是一张看得了的图')
          console.log(`  ↳ 它看了《${e.title}》第 ${index || 1} 张（进上下文了）`)
          return { content: [
            { type: 'text', text: `# ${e.title}（第 ${index || 1} 张，共 ${e.images.length} 张）` },
            { type: 'image', data: got.data, mimeType: got.mimeType },
          ] }
        } catch (err) {
          // 取不回来就明说取不回来。返回半通不通的东西更糟——那会被当成
          // "我看过这张图了"，然后基于没看见的东西去改描述。
          return { content: [{ type: 'text', text: `《${e.title}》第 ${index || 1} 张打不开：${err.message}` }] }
        }
      })]
  })
}
```

`images` 是外站 URL，所以这台工具自己 `fetch`，拿 `arrayBuffer`，
过一遍 `files.js` 的 `read()`。取不回来、状态码不对、`read()` 判出来不是图，
**一律明说取不回来**，返回一句人话，不返回半通不通的东西。

挂上去：

```js
const imgCount = isStudio ? ctx.entries.filter((e) => e.images?.length).length : 0
const tools = isStudio
  ? (imgCount ? [...READ_TOOLS, WORK_IMG_TOOL] : READ_TOOLS)
  : (atts.length ? [...READ_TOOLS, FILE_TOOL] : READ_TOOLS)
```

**一张图都没有就不挂这台工具**——挂着等于告诉它「你可以去看图」，
然后它去开一个不存在的东西，白跑一轮。（跟 `filesServer` 同一条道理。）

- [ ] **Step 6：路由的日志行**

`/chat` 那个 handler 里那行 `console.log`，桌子这边打
`` `书桌 ${body.section}` ``，跟现有 `人 ${contact_id}` 一个样式。

- [ ] **Step 7：全量测试不许红**

Run: `npm test`
Expected: 全绿（这一步只加岔路，没动任何现有分支）

- [ ] **Step 8：提交**

```bash
git add brain/server.js supabase/migrations/0127_a_desk_in_the_archive.sql
git commit -m "brain 认第三种主人：书桌。不写信不填表不动状态机，只多一台看图的"
```

---

### Task 5：前端那一层

**Files:**
- Modify: `src/lib/chat.js`（`ownerBody`）
- Create: `src/lib/chat.test.js`
- Create: `src/lib/studio.js`
- Create: `src/lib/studio.test.js`

**Interfaces:**
- Produces:
  - `ownerBody({kind:'studio', id:'work'})` → `{ section: 'work' }`
  - `fetchStudioThread(section) -> rows | null`
  - `rewindStudio(msgId) -> number`
  - `setEntryDraft(id, draft) -> void`
  - `addEntry(kind, title) -> uuid`
  - `focusOf(section, open) -> { label, count, open:[{id,title}] }`（纯函数，可测）

- [ ] **Step 1：写红的测试**

`src/lib/chat.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert'
import { ownerBody } from './chat.js'

test('ownerBody：三种主人', () => {
  assert.deepEqual(ownerBody('p1'), { pursuit_id: 'p1' })
  assert.deepEqual(ownerBody({ kind: 'contact', id: 'c1' }), { contact_id: 'c1' })
  assert.deepEqual(ownerBody({ kind: 'studio', id: 'work' }), { section: 'work' })
  assert.deepEqual(ownerBody({ kind: 'pursuit', id: 'p2' }), { pursuit_id: 'p2' })
})
```

`src/lib/studio.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert'
import { focusOf } from './studio.js'

const SEC = { key: 'work', label: '作品', items: [
  { id: 'a', title: '花园' }, { id: 'b', title: '海' }, { id: 'c', title: '山' },
] }

test('focusOf：展开着的那几条带 id 报上去', () => {
  const f = focusOf(SEC, new Set(['a', 'c']))
  assert.equal(f.label, '作品')
  assert.equal(f.count, 3)
  assert.deepEqual(f.open, [{ id: 'a', title: '花园' }, { id: 'c', title: '山' }])
})

test('focusOf：一条没展开，open 是空数组不是 undefined', () => {
  assert.deepEqual(focusOf(SEC, new Set()).open, [])
})

test('focusOf：「关于你」那一格没有条目，count 是 0 不炸', () => {
  const f = focusOf({ key: 'about', label: '关于你' }, new Set())
  assert.equal(f.count, 0)
  assert.deepEqual(f.open, [])
})

test('focusOf：展开着的条目已经不在这一栏里了（库变了），不许漏进去', () => {
  const f = focusOf(SEC, new Set(['a', '已经没了']))
  assert.deepEqual(f.open, [{ id: 'a', title: '花园' }])
})
```

- [ ] **Step 2：跑，确认红**

Run: `node --test src/lib/chat.test.js src/lib/studio.test.js`
Expected: FAIL —— `studio.js` 不存在；`ownerBody` 那条 studio 断言挂

- [ ] **Step 3：实现**

`chat.js` 的 `ownerBody` 加一岔（**注意判断顺序**：`kind === 'studio'` 要在
最后那个兜底 `{ pursuit_id: owner?.id }` 之前）：

```js
export const ownerBody = (owner) =>
  typeof owner === 'string' ? { pursuit_id: owner }
    : owner?.kind === 'contact' ? { contact_id: owner.id }
      : owner?.kind === 'studio' ? { section: owner.id }
        : { pursuit_id: owner?.id }
```

`src/lib/studio.js`：`focusOf` 是纯函数（上面测试定死了形状）；
另外四支走 `supa.rpc`，照 [`entries.js`](../../src/lib/entries.js) 那个写法
（没连库就抛一句人话）。

- [ ] **Step 4：跑，确认绿**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5：`package.json` 的 test 脚本本来就是 `src/lib/*.test.js`，
  新文件自动被捡进去。确认一下数量变了**

Run: `npm test 2>&1 | tail -5`
Expected: 通过数比上一次多

- [ ] **Step 6：提交**

```bash
git add src/lib/chat.js src/lib/chat.test.js src/lib/studio.js src/lib/studio.test.js
git commit -m "前端认书桌：ownerBody 第三种、焦点算法、加条目和 draft 两支"
```

---

### Task 6：把消息渲染抽出来共用

**Files:**
- Create: `src/components/Thread.jsx`
- Modify: `src/components/PursuitFocus.jsx`

**Interfaces:**
- Produces: `<Thread msgs busy live thinking onResay ... />`——
  气泡、流式那三点、「重说」、空态

- [ ] **Step 1：先确认现状（这一步是防止抽错）**

Run: `grep -n "msgs.map\|bubble md streaming\|bubble thinking" src/components/PursuitFocus.jsx`
把那一段连同它依赖的子组件（`Message` 及其以下）看一遍。

- [ ] **Step 2：抽。原则是搬，不是重写**

把 `Message` 和它下面那几个（`Arrival` / 笔卡 / 邮件锚点）连同
`msgs.map(...)` 那一块整体搬进 `Thread.jsx`，**一个字都不改逻辑**。
机会线专有的东西（`StateMoveCard`、产出标记、邮件锚点）通过 props 传进来，
不传就不画——桌子那边一个都不传。

- [ ] **Step 3：`PursuitFocus` 改成用 `<Thread>`**

- [ ] **Step 4：全量测试 + 人工比对**

Run: `npm test`
Expected: 全绿

然后**把 dev server 的命令给他**（先 `lsof -i :5173` 看端口），
让他打开一条机会线，确认气泡、流式、「重说」、信卡、笔卡**一样都没少**。
**这一步必须他点头才往下走**——这是这次唯一碰到现有页面的改动。

- [ ] **Step 5：提交**

```bash
git add src/components/Thread.jsx src/components/PursuitFocus.jsx
git commit -m "消息渲染抽成 Thread：两张桌子共用一种气泡"
```

---

### Task 7：`StudioChat` + 档案页三栏

**Files:**
- Create: `src/components/StudioChat.jsx`
- Modify: `src/components/Library.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 5 的 `focusOf` / `fetchStudioThread` / `rewindStudio`；
  Task 6 的 `<Thread>`；`chat.js` 的 `sendMessageStream`（走
  `{kind:'studio', id:section}`）
- Produces: 档案页右栏

- [ ] **Step 1：`Entry` 的展开状态提上去**

现在 `open` 是 `Entry` 自己的 `useState`（一条一个），焦点算不出来。
改成 `Library` 里一个 `useState(new Set())`，`Entry` 收 `open` 和 `onToggle`。
**行为一个字不变**：还是点空白展开、点 `chev` 展开，还是可以同时开好几条。

- [ ] **Step 2：`StudioChat`**

props：`section`（key）、`focus`（`focusOf` 的返回）。
`section` 变了就重新 `fetchStudioThread`。发话走
`sendMessageStream({kind:'studio', id:section}, text, null, runId, onEvent)`——
**但现有 `sendMessageStream` 第一个参数是 `pursuitId` 字符串**，
签名要改成收 owner（内部已经有 `ownerBody`，改一行）。

空态写一句它是干嘛的，别写「开始聊天吧」这种废话。

- [ ] **Step 3：三栏**

`Library` 的 `.lib-two` 变 `.lib-three`：`208px + minmax(0,1fr) + 380px`，
`.page-inner.wide` 的 `max-width` 从 1040 放到 1480。
窄屏断点里聊天收起来，留一个把手（照 [`DrawerGrip`](../../src/components/DrawerGrip.jsx) 那套）。

- [ ] **Step 4：跑起来看**

**不要自己起 server。** `lsof -i :5173` 确认端口，把命令给他。
起来之后用 playwright 截图（MCP 被锁就走
[`docs/dev`](../dev) 里那条 npx 缓存的路子），三栏、发一句话、
看它回、「重说」撤一条，各截一张。

- [ ] **Step 5：提交**

```bash
git add src/components/StudioChat.jsx src/components/Library.jsx src/styles.css
git commit -m "档案页第三栏：一栏一张书桌"
```

---

### Task 8：「加一条」和 draft 的标

**Files:**
- Modify: `src/components/Library.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 5 的 `addEntry` / `setEntryDraft`

- [ ] **Step 1：`KindSection` 标题行加「+ 加一条」**

按下去 `addEntry(kind, '（未命名）')` → `onEntrySaved()` 重读 →
新那条自动展开、标题进编辑态（`InlineText` 已经支持）。
`about` 那一格没有这个按钮（它是 profile，不是条目）。

`credit:*` 那三格的 kind 都是 `credit`，加出来的条目 `meta.type` 是空的，
会落进「其他战绩」那一格——**这是对的**，type 是他建完自己填的，
不该由按钮猜。

- [ ] **Step 2：折叠行上的 draft chip**

挨着现在那个「盒子 · 已补 N 条」。`draft` 的显示「在写」，
点一下 `setEntryDraft(id, false)` 变「写完」。没连库（`canEdit` 假）时不可点。

- [ ] **Step 3：左栏那一格显示「N 条在写」**

跟现在 `rail-n` 那个条数同一个位置。**这一条不能省**：
`draft` 的东西 Fairwind 看不见，而他写完忘了点标的话，
下周它写申请时不会用，且收不到任何提示。左栏那个数字就是那个提示。

- [ ] **Step 4：跑起来看 + 截图**

加一条、改标题、切「写完」、看左栏计数跟着变。

- [ ] **Step 5：提交**

```bash
git add src/components/Library.jsx src/styles.css
git commit -m "档案页终于能加条目了；没写完的挂个「在写」"
```

---

### Task 9：收尾

- [ ] **Step 1：全量测试**

Run: `npm test`
Expected: 全绿，一条不红

- [ ] **Step 2：把迁移应用到真库**

用 Supabase MCP `apply_migration`。**先问他。**

- [ ] **Step 3：真库上验一遍**

brain 起着（他起），在档案页每一栏各说一句，确认：
对话存下来了、刷新还在、「重说」能撤、它答的话里引得出他真实的作品。

- [ ] **Step 4：截图给他**

- [ ] **Step 5：更新 README 的「下一步（未做）」那一段**（如果这稿把某条做掉了）
