# 从 Fairwind 直接发信 · 施工计划

> **给执行的人：** 用 superpowers:subagent-driven-development（推荐）或
> superpowers:executing-plans 一个任务一个任务地做。步骤用 `- [ ]` 勾。

**目标：** 信在产出里改、在产出里发，发完当场记进往来，产出消失。

**做法：** brain 的 OAuth scope 加 `gmail.send`，发送做成 brain 里一个**纯 HTTP 函数**
（不进模型的工具白名单）。Fairwind 写信时在回复末尾吐一个 `[[LETTER]]` 信封块，
你在对话里点一下把它收成产出，改完按发送。

**技术栈：** Node（brain，`node --test`）· googleapis · marked · React + Vite · Supabase RPC

**设计稿：** [`docs/specs/2026-08-16-send-from-fairwind-design.md`](../specs/2026-08-16-send-from-fairwind-design.md)

## 全局约束

- 测试跑法：`npm test`（根目录）。它只扫这三个 glob：
  `src/lib/*.test.js`、`brain/*.test.js`、`brain/mail/*.test.js`。**新测试必须落在这三处**，
  否则永远不会被跑到。
- 标记名用 `[[LETTER]]`。**不许用 `[[MAIL]]`**——`brain/server.js` 的同步路径已经占了那个名字。
- 发送**不改球权**。球权是纯手动标签（0058，`ball_eff` 直接等于你点的那个）。
- 记账顺序永远是**先记账、后删产出**。
- 迁移照 0025 的规矩：`create or replace` 必须整段重写，不许省 `security definer`
  和 `set search_path`。
- 模型的工具白名单（`brain/server.js` 的 `READ_TOOLS` / `GMAIL_TOOLS`）**一个字都不加**。
  发送口不给模型。

---

### Task 1: 信封的解析

**Files:**
- Create: `brain/letter.js`
- Test: `brain/letter.test.js`

**Interfaces:**
- Produces: `extractLetter(text) -> { clean: string, letter: object|null }`
  —— `letter` 形如 `{ to, subject, summary, reply_to, thread_id }`，
  解析不出来时是 `null`，`clean` 则是原文去掉标记行之后的正文。

- [ ] **Step 1: 写会失败的测试**

```js
// brain/letter.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { extractLetter } from './letter.js'

test('摘出信封，正文里不留标记', () => {
  const raw = '亲爱的 Ana：\n\n谢谢你的回信。\n\n[[LETTER]] {"to":"ana@x.org","subject":"Re: 驻地","summary":"回 Ana，确认档期"}'
  const { clean, letter } = extractLetter(raw)
  assert.equal(clean, '亲爱的 Ana：\n\n谢谢你的回信。')
  assert.equal(letter.to, 'ana@x.org')
  assert.equal(letter.subject, 'Re: 驻地')
  assert.equal(letter.summary, '回 Ana，确认档期')
  assert.equal(letter.reply_to, null)
  assert.equal(letter.thread_id, null)
})

test('没有信封就当没有，正文原样交出', () => {
  const { clean, letter } = extractLetter('就是一段普通回复。')
  assert.equal(clean, '就是一段普通回复。')
  assert.equal(letter, null)
})

test('信封坏了不能连累正文', () => {
  const raw = '正文在这儿。\n\n[[LETTER]] {坏掉的 json'
  const { clean, letter } = extractLetter(raw)
  assert.equal(clean, '正文在这儿。')
  assert.equal(letter, null)
})

test('没有收件人的信封不算信封——发不出去的信封是骗人的', () => {
  const raw = '正文。\n\n[[LETTER]] {"subject":"没有收件人"}'
  const { letter } = extractLetter(raw)
  assert.equal(letter, null)
})

test('收件人一律小写去空格', () => {
  const raw = '正文。\n\n[[LETTER]] {"to":"  Ana@X.ORG "}'
  assert.equal(extractLetter(raw).letter.to, 'ana@x.org')
})
```

- [ ] **Step 2: 跑一次，确认它红**

Run: `npm test`
Expected: FAIL，`Cannot find module './letter.js'`

- [ ] **Step 3: 写实现**

```js
// brain/letter.js
// 「这段回复是一封信」的信封。
//
// 跟 extractFacts 是同一个路子：机器读的那行贴在回复末尾，摘出来之后
// 从展示文本里去掉。**不叫 [[MAIL]]**——那个名字被同步那条路占着，
// 撞名的话两处解析会互相咬。
//
// 这里判断的只是「形式上这是一封信」，不是「这封该不该发」。该不该发
// 是你点「收进产出」那一下，永远不由它决定。
//
// 一条硬规矩：**信封坏了绝不能连累正文**。回复本身是它想了半天的东西，
// 为了一行机器读的字把它整个丢掉，是这儿能犯的最蠢的错。
const TAG = /\[\[LETTER\]\]\s*(\{[\s\S]*?\})\s*$/

const clean1 = (s) => {
  const t = String(s ?? '').trim()
  return t || null
}

export function extractLetter(text) {
  const src = String(text ?? '')
  const m = src.match(TAG)
  if (!m) return { clean: src.trim(), letter: null }

  const clean = src.slice(0, m.index).trim()

  let j
  try { j = JSON.parse(m[1]) } catch (_) { return { clean, letter: null } }

  // 没有收件人就不是一封能发的信。留着它只会让界面画出一张点了没反应的卡。
  const to = clean1(j?.to)?.toLowerCase()
  if (!to || !to.includes('@')) return { clean, letter: null }

  return {
    clean,
    letter: {
      to,
      subject: clean1(j?.subject) || '（无主题）',
      summary: clean1(j?.summary),
      reply_to: clean1(j?.reply_to),
      thread_id: clean1(j?.thread_id),
    },
  }
}
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add brain/letter.js brain/letter.test.js
git commit -m "信封：认出「这段回复是一封信」"
```

---

### Task 2: Fairwind 写信时吐信封，屏幕上不许闪出来

**Files:**
- Modify: `brain/prompt.js`（人格/规矩那一段末尾加一条写信约定）
- Modify: `brain/server.js:430`（存回复那一处）
- Modify: `src/lib/liveText.js`
- Test: `brain/prompt.test.js`、`src/lib/liveText.test.js`

**Interfaces:**
- Consumes: Task 1 的 `extractLetter`
- Produces: 对话消息的 `meta.letter`（`{to,subject,summary,reply_to,thread_id}`），
  前端据此画信卡；`stripTag(text) -> string` 供边想边出字时用

- [ ] **Step 1: 写会失败的测试（prompt 里得有这条约定）**

```js
// brain/prompt.test.js —— 加在现有测试后面
test('写信时要求吐信封，且明说标记名', () => {
  const p = promptLines(FIXTURE)   // 用文件里现成的那个夹具
  const all = [p.fixed, p.perLine, p.talk].join('\n')
  assert.match(all, /\[\[LETTER\]\]/)
  assert.match(all, /只有.*真的写了一封信.*才/s)
})
```

```js
// src/lib/liveText.test.js —— 加在现有测试后面
import { stripTag } from './liveText.js'

test('边想边出字时，末尾那行机器读的字不上屏', () => {
  assert.equal(stripTag('正文。\n\n[[LETTER]] {"to":"a@b.c"}'), '正文。')
})

test('标记才流出来一半也不许露脸', () => {
  assert.equal(stripTag('正文。\n\n[[LET'), '正文。')
  assert.equal(stripTag('正文。\n\n[[LETTER]] {"to":"a@'), '正文。')
})

test('正文里本来就有方括号的不能被误伤', () => {
  assert.equal(stripTag('见 [1] 那条。'), '见 [1] 那条。')
})
```

- [ ] **Step 2: 跑一次，确认两个都红**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: prompt 里加约定**

在 `brain/prompt.js` 里那份「人格 + 规矩」的 `fixed` 段末尾加：

```js
// 写信这件事要留个机器读的记号，否则它写完的信只能靠人复制走。
// **只在真的写了一封信时才吐**——这是形式判断（有收件人、有主题、有称呼
// 和落款），不是「这封该不该发」。该不该发是他点那一下。
const LETTER_RULE = `
## 写信的时候

只有当你**真的写了一封可以直接发出去的信**（有收件人、有主题、有称呼和落款）时，
在整段回复的**最后一行**单独加上这个，别的什么都不要加：

[[LETTER]] {"to":"收件人地址","subject":"主题","summary":"一句话说清这封信在说什么","reply_to":"回的那封信的 Message-ID，没有就 null","thread_id":"Gmail threadId，没有就 null"}

· 只是在讨论"这封信该怎么写"、给个语气示范、列几条要点——**都不要加**。
· 收件人从这条线的往来里挑最近那个对手方；拿不准就别加这一行。
· summary 直接会被记进往来里当那一行摘要，用中文，二十来字。
`
```

把 `LETTER_RULE` 接进 `fixed` 段（跟其它规矩并列，注意别破坏 `prompt.test.js`
里那份逐字比对的尺子——按测试的提示调整拼接位置）。

- [ ] **Step 4: 存回复时把信封摘进 meta**

`brain/server.js` 顶部加 `import { extractLetter } from './letter.js'`，
把 430 行那处改成：

```js
  // 信封摘出来存进 meta：**正文里不留那行机器读的字**。
  // 留着的话，你复制走的时候会连它一起复制进 Gmail。
  const { clean: shown, letter } = extractLetter(reply)
  const theirs = await addMessage(owner, 'producer', shown, 'message',
    notes?.length || recovered || letter
      ? { ...(notes?.length ? { notes } : {}), ...(recovered ? { recovered: true } : {}),
          ...(letter ? { letter } : {}) }
      : null)
```

- [ ] **Step 5: liveText 加 stripTag**

```js
// src/lib/liveText.js —— 加在文件末尾
/**
 * 边想边出字时，末尾那行机器读的记号不上屏。
 *
 * 它是一个字一个字流出来的，所以**流到一半也得挡**——不挡的话你会先看见
 * 「[[LET」「[[LETTER]] {"to":"a@」这种半截东西在屏幕上长出来，
 * 想完之后又忽然消失，看起来像出了什么毛病。
 *
 * 只咬末尾，且必须是 `[[` 开头的那一串——正文里的 [1] 这类方括号碰不着。
 */
export const stripTag = (t) =>
  String(t ?? '').replace(/\n*\[\[(?:[A-Z]*(?:\]\][\s\S]*)?)?$/, '').trimEnd()
```

在画预览的地方（`src/lib/useLiveReply.js` 交出文本那一处）套上 `stripTag`。

- [ ] **Step 6: 跑测试，确认全绿**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add brain/prompt.js brain/prompt.test.js brain/server.js src/lib/liveText.js src/lib/liveText.test.js src/lib/useLiveReply.js
git commit -m "它写完信会说一声：回复末尾吐信封，屏幕上不露脸"
```

---

### Task 3: 对话里那张信卡，点一下收进产出

**Files:**
- Create: `supabase/migrations/0068_a_letter_lands_in_the_page.sql`
- Create: `src/components/LetterCard.jsx`
- Create: `src/lib/letters.js`
- Modify: `src/components/PursuitFocus.jsx`、`src/components/PersonFocus.jsx`（渲染信卡）
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 2 存进消息 `meta.letter` 的那个对象
- Produces: `pa_adopt_letter(p_pursuit_id uuid, p_contact_id uuid, p_to text,
  p_subject text, p_body text, p_meta jsonb) returns producer.deliverables`；
  前端 `adoptLetter({ pursuitId, contactId }, letter, body) -> deliverable`

- [ ] **Step 1: 写迁移**

```sql
-- supabase/migrations/0068_a_letter_lands_in_the_page.sql
--
-- 「Fairwind 写的信从来进不了产出」——从根上治。
--
-- ══ 真事 ══════════════════════════════════════════════════════
-- PersonFocus 上写着「在中栏跟 Fairwind 说『帮我回他』，它写的草稿会出现在这儿」。
-- 那是一句从未兑现过的话：模型的工具白名单里根本没有能建产出的口，
-- 所以那一栏永远是空的，右边那颗「放进 Gmail 草稿箱」也就永远够不着。
-- 于是真实用法退化成：从对话气泡里选中、复制、切去 Gmail 粘贴。
--
-- ══ 为什么是「你点一下」，不是自动 ════════════════════════════
-- 让模型判断「这段该不该收进产出」是猜意图，会漏也会滥。改成两半：
-- 形式判断归它（这是一封信，有收件人有主题——它写的时候本来就知道），
-- 意图判断归你（这封要发）。这支函数就是你那一下。
--
-- ══ 一个所有者只留一份待发信 ══════════════════════════════════
-- 在对话里让它改五版、你收五次，产出栏该是**一份**最新的，不是五份。
-- 理由跟 0066（重说）一样：草稿的「最新一版」只有一个。
-- 所以这支是 upsert：同一个所有者名下已有 draft 的 email 产出就覆盖它。
--
-- 照 0025 的规矩：create or replace 必须整段重写，漏掉 security definer
-- 或 search_path 会悄悄改掉权限模型且不报错。
create or replace function public.pa_adopt_letter(
  p_pursuit_id uuid  default null,
  p_contact_id uuid  default null,
  p_to         text  default null,
  p_subject    text  default '（无主题）',
  p_body       text  default '',
  p_meta       jsonb default '{}'::jsonb
) returns producer.deliverables
language plpgsql security definer set search_path = public, producer
as $$
declare r producer.deliverables; existing uuid; cp text;
begin
  if (p_pursuit_id is null) = (p_contact_id is null) then
    raise exception '要么挂在一条机会线上，要么挂在一个人身上，不能都给也不能都不给';
  end if;

  cp := lower(btrim(coalesce(p_to, '')));
  if cp not like '%@%' then
    raise exception '没有收件人的信收进来也发不出去（收到 %）', coalesce(p_to, 'null');
  end if;

  -- 已经有一份待发信就覆盖它，不再生一份
  select id into existing from producer.deliverables
   where kind = 'email' and status = 'draft'
     and (pursuit_id is not distinct from p_pursuit_id)
     and (contact_id is not distinct from p_contact_id)
   order by created_at desc limit 1;

  if existing is null then
    insert into producer.deliverables
      (pursuit_id, contact_id, kind, title, body, meta, created_by, status)
    values (p_pursuit_id, p_contact_id, 'email', p_subject, p_body,
            coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('to', cp),
            'fairwind', 'draft')
    returning * into r;
  else
    update producer.deliverables
       set title = p_subject,
           body  = p_body,
           -- meta 合并不替换：thread_id / reply_to 这些不该被后一版抹掉
           meta  = coalesce(meta, '{}'::jsonb) || coalesce(p_meta, '{}'::jsonb)
                     || jsonb_build_object('to', cp)
     where id = existing
    returning * into r;
  end if;

  return r;
end $$;

-- 这是**你的手**（点「收进产出」），所以给 anon；不给它就得绕一趟 brain，
-- 而 brain 没开的时候你连收都收不了。
revoke all on function public.pa_adopt_letter(uuid, uuid, text, text, text, jsonb)
  from public;
grant execute on function public.pa_adopt_letter(uuid, uuid, text, text, text, jsonb)
  to anon, authenticated, service_role;

comment on function public.pa_adopt_letter(uuid, uuid, text, text, text, jsonb) is
  '把对话里那封信收成一份待发的 email 产出。一个所有者只留一份，重收是覆盖。';
```

- [ ] **Step 2: 应用迁移**

用 Supabase MCP 的 `apply_migration` 应用到项目 `jjgvvtrsnoqnoigukobi`，
名字 `0068_a_letter_lands_in_the_page`。

- [ ] **Step 3: 前端那一层**

```js
// src/lib/letters.js
// 对话里那封信 → 产出里那份待发信。
//
// 走浏览器直连 anon：这是**你的手**，不该依赖脑子开着。跟翻案（mail.js）
// 是同一条理由——brain 没开的时候，你照样收得下、改得动。
import { supa } from './backends.js'

export async function adoptLetter(owner, letter, body) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { data, error } = await supa.rpc('pa_adopt_letter', {
    p_pursuit_id: owner.pursuitId || null,
    p_contact_id: owner.contactId || null,
    p_to: letter.to,
    p_subject: letter.subject,
    p_body: body,
    p_meta: {
      reply_to: letter.reply_to || null,
      thread_id: letter.thread_id || null,
      summary: letter.summary || null,
    },
  })
  if (error) throw new Error(error.message)
  return data
}
```

```jsx
// src/components/LetterCard.jsx
import React, { useState } from 'react'
import { adoptLetter } from '../lib/letters.js'

// 对话里那条回复其实是一封信 —— 就画成一封信的样子。
//
// 卡上只有一颗按钮，而且**不是「发送」**。收进产出和发送之间隔着一步，
// 那一步是给你改字用的。合成一步的话，「点错一下就发出去了」这种错
// 在这个系统里第一次变得可能。
export default function LetterCard({ letter, body, owner, onAdopted }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function go() {
    setBusy(true); setErr(null)
    try {
      await adoptLetter(owner, letter, body)
      await onAdopted?.()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="lcard">
      <div className="lcard-h">
        <span className="lcard-tag">这是一封信</span>
        <span className="lcard-to">给 {letter.to}</span>
      </div>
      <div className="lcard-sub">{letter.subject}</div>
      {err && <div className="lcard-err">{err}</div>}
      <button className="lnk" disabled={busy} onClick={go}>
        {busy ? '收着……' : '收进产出（去那儿改完再发）'}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: 接进两个专注页**

`PursuitFocus.jsx` 和 `PersonFocus.jsx` 里渲染中栏消息的地方，
在 `m.role === 'producer' && m.meta?.letter` 时，紧跟在气泡后面画一张
`<LetterCard letter={m.meta.letter} body={m.content} owner={…} onAdopted={refresh} />`。

`src/styles.css` 里加 `.lcard` 那几条（照 `.mail` / `.pf-del` 现有的样子写，
别自造一套配色）。

- [ ] **Step 5: 手动验一遍**

跑 `npm run dev` + `npm run brain`，在一条真线上说「帮我回他」：
1. 对话里出现信卡，收件人和主题都对
2. 点「收进产出」→ 右栏出现一份 email 产出，标题=主题，正文=信
3. 让它再改一版、再收一次 → 产出还是**一份**，内容是新的

- [ ] **Step 6: 提交**

```bash
git add supabase/migrations/0068_a_letter_lands_in_the_page.sql src/lib/letters.js src/components/LetterCard.jsx src/components/PursuitFocus.jsx src/components/PersonFocus.jsx src/styles.css
git commit -m "对话里那封信收得进产出了——那句从未兑现的话终于兑现"
```

---

### Task 4: 组一封真的信（纯函数）

**Files:**
- Create: `brain/mail/mime.js`
- Test: `brain/mail/mime.test.js`

**Interfaces:**
- Produces:
  - `encodeHeader(s) -> string`（非 ASCII 走 RFC 2047）
  - `newMessageId(fromAddr) -> string`（形如 `<uuid@domain>`）
  - `buildMime({ from, fromName, to, subject, text, html, messageId, inReplyTo, refs, date, boundary }) -> string`
  - `toRaw(mime) -> string`（base64url）

- [ ] **Step 1: 写会失败的测试**

```js
// brain/mail/mime.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeHeader, newMessageId, buildMime, toRaw } from './mime.js'

const BASE = {
  from: 'me@example.com', fromName: 'Hu Di', to: 'ana@x.org',
  subject: 'Re: 驻地', text: '你好', html: '<p>你好</p>',
  messageId: '<abc@example.com>',
  date: new Date('2026-08-16T10:00:00Z'), boundary: 'B0UND',
}

test('纯 ASCII 的头原样不动', () => {
  assert.equal(encodeHeader('Re: residency'), 'Re: residency')
})

test('带中文的头走 RFC 2047，不是原样塞进去', () => {
  const got = encodeHeader('回复：驻地')
  assert.match(got, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
  assert.equal(Buffer.from(got.slice(10, -2), 'base64').toString('utf8'), '回复：驻地')
})

test('Message-ID 用发信地址的域名', () => {
  assert.match(newMessageId('me@example.com'), /^<[0-9a-f-]{36}@example\.com>$/)
})

test('两份正文都在，纯文本在前', () => {
  const m = buildMime(BASE)
  assert.match(m, /Content-Type: multipart\/alternative; boundary="B0UND"/)
  const plainAt = m.indexOf('text/plain')
  const htmlAt = m.indexOf('text/html')
  assert.ok(plainAt > 0 && htmlAt > plainAt, '纯文本必须排在 html 前面')
  assert.match(m, /--B0UND--\s*$/)
})

test('正文用 base64 编，中文不会被截断成乱码', () => {
  const m = buildMime(BASE)
  const part = m.split('--B0UND')[1]
  assert.match(part, /Content-Transfer-Encoding: base64/)
  const b64 = part.trim().split('\n').pop().trim()
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), '你好')
})

test('回信带 In-Reply-To 和 References——0055 靠它认亲', () => {
  const m = buildMime({ ...BASE, inReplyTo: '<x@y>', refs: ['<w@y>', '<x@y>'] })
  assert.match(m, /In-Reply-To: <x@y>/)
  assert.match(m, /References: <w@y> <x@y>/)
})

test('新起一封就不许有这两个头——空的 In-Reply-To 会让对方客户端挂错串', () => {
  const m = buildMime(BASE)
  assert.doesNotMatch(m, /In-Reply-To:/)
  assert.doesNotMatch(m, /References:/)
})

test('头里塞换行的一律拒——那是往信头里注入别的头', () => {
  assert.throws(() => buildMime({ ...BASE, subject: '正常\r\nBcc: evil@x.com' }), /换行/)
  assert.throws(() => buildMime({ ...BASE, to: 'a@b.c\nBcc: evil@x.com' }), /换行/)
})

test('raw 是 base64url，不带 + / =', () => {
  const raw = toRaw(buildMime(BASE))
  assert.doesNotMatch(raw, /[+/=]/)
})
```

- [ ] **Step 2: 跑一次，确认它红**

Run: `npm test`
Expected: FAIL，`Cannot find module './mime.js'`

- [ ] **Step 3: 写实现**

```js
// brain/mail/mime.js
// 把一封信组成 RFC 822 的样子。**纯函数，不碰网也不碰库**，所以测得了。
//
// 为什么不用现成的库：要的就那么几个头，而且这一步出错的方式很吓人——
// 主题编错了对方看见一串乱码，头里混进换行等于让别人替你加 Bcc。
// 这些都得能被测试按住，所以宁可自己写一百行，也不吞一个黑盒。
import { randomUUID } from 'node:crypto'

/**
 * 非 ASCII 的头得编码（RFC 2047），否则对方看到的是一串乱码。
 * 纯 ASCII 的原样留着——编了反而让信头难读。
 */
export function encodeHeader(s) {
  const t = String(s ?? '')
  if (!/[^\x20-\x7E]/.test(t)) return t
  return `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=`
}

/** 自己生成 Message-ID：发出去之后要把它记进 mail_headers，不能等 Gmail 告诉我们。 */
export function newMessageId(fromAddr) {
  const domain = String(fromAddr).split('@')[1] || 'localhost'
  return `<${randomUUID()}@${domain}>`
}

// 头里出现换行 = 有人在往信头里塞别的头（最典型的是 Bcc）。
// 这不是「清理一下」的事，是当场拒绝——静悄悄删掉的话，你永远不知道
// 刚才那封信到底发给了谁。
const noBreaks = (label, v) => {
  const t = String(v ?? '')
  if (/[\r\n]/.test(t)) throw new Error(`${label} 里不许有换行：${JSON.stringify(t)}`)
  return t
}

const b64 = (s) => Buffer.from(String(s ?? ''), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')

export function buildMime({
  from, fromName, to, subject, text, html,
  messageId, inReplyTo = null, refs = null,
  date = new Date(), boundary = `b${randomUUID().replace(/-/g, '')}`,
}) {
  noBreaks('收件人', to)
  noBreaks('主题', subject)
  noBreaks('发信人', fromName)

  const h = [
    `From: ${fromName ? `${encodeHeader(fromName)} <${from}>` : from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${messageId}`,
  ]
  // 新起一封就一个都不许有：空的 In-Reply-To 会让对方客户端挂到一个不存在的串上
  if (inReplyTo) h.push(`In-Reply-To: ${noBreaks('In-Reply-To', inReplyTo)}`)
  if (refs?.length) h.push(`References: ${refs.map((r) => noBreaks('References', r)).join(' ')}`)
  h.push('MIME-Version: 1.0')
  h.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)

  // 纯文本排在前面：multipart/alternative 的规矩是**后面的优先**，
  // 所以想让对方优先看见 html，html 就得在后面。反了的话富文本客户端
  // 显示的是纯文本版，粗体变成四个星号——Md.jsx 那条注释记的就是这个。
  return [
    h.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

/** Gmail 的 send 要 base64url。 */
export const toRaw = (mime) =>
  Buffer.from(mime, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
```

- [ ] **Step 4: 跑测试，确认绿**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add brain/mail/mime.js brain/mail/mime.test.js
git commit -m "组一封真的信：头会编码，换行注入当场拒"
```

---

### Task 5: markdown 渲成 html，屏幕上什么样对方收到什么样

**Files:**
- Create: `brain/mail/render.js`
- Test: `brain/mail/render.test.js`
- Modify: `brain/package.json`

**Interfaces:**
- Produces: `renderBody(md) -> { text: string, html: string }`

- [ ] **Step 1: 装依赖**

```bash
npm install marked --prefix brain
```

（只装一个：`marked` 的 `{ gfm:true, breaks:true }` 正好对上前端那套
`remark-gfm + remark-breaks` 的两条关键语义。搬一整套 remark 要六个包，
换来的差别在这几种构造上看不出来。）

- [ ] **Step 2: 写会失败的测试**

```js
// brain/mail/render.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderBody } from './render.js'

test('粗体是粗体，不是四个星号', () => {
  const { html, text } = renderBody('请看**这一句**。')
  assert.match(html, /<strong>这一句<\/strong>/)
  assert.equal(text, '请看**这一句**。')   // 纯文本那份原样留着 md，这是纯文本该有的样子
})

test('单个换行就换行——Fairwind 写的东西是按行分的', () => {
  const { html } = renderBody('第一行\n第二行')
  assert.match(html, /第一行<br>\s*第二行/)
})

test('列表是列表', () => {
  const { html } = renderBody('- 甲\n- 乙')
  assert.match(html, /<ul>[\s\S]*<li>甲<\/li>[\s\S]*<li>乙<\/li>[\s\S]*<\/ul>/)
})

test('链接能点', () => {
  assert.match(renderBody('见 https://hudiworks.com').html, /<a href="https:\/\/hudiworks\.com"/)
})

test('空正文不炸', () => {
  const { text, html } = renderBody('')
  assert.equal(text, '')
  assert.equal(html.trim(), '')
})
```

- [ ] **Step 3: 跑一次，确认它红**

Run: `npm test`
Expected: FAIL

- [ ] **Step 4: 写实现**

```js
// brain/mail/render.js
// 库里的文字都是 markdown。发出去之前得渲一遍。
//
// ══ 为什么这一步不能省 ════════════════════════════════════════
// Md.jsx 那条注释记着一次事故：同一份内容在机会线上是粗体，在名片上是
// 四个星号明晃晃摆在脸上，「同一份内容两个样子，而且丑的那个看起来像坏了」。
// 只发纯文本，就是把那次事故复现到**收件人的信箱里**——而那一份你看不见，
// 也改不回来。
//
// 两条语义必须跟前端对齐：
//   gfm    —— 列表、自动链接（前端的 remark-gfm）
//   breaks —— 单个换行就换行（前端的 remark-breaks）
// 不对齐的话，你在屏幕上校对的那一版和对方收到的那一版是两个东西。
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

/**
 * 一份正文的两个身体。
 *
 * text 那份**原样留着 markdown**，不做任何降级处理——纯文本客户端里
 * `**这样**` 读得懂，硬把星号删掉反而丢了强调。
 */
export function renderBody(md) {
  const text = String(md ?? '')
  return { text, html: text ? marked.parse(text) : '' }
}
```

- [ ] **Step 5: 跑测试，确认绿**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add brain/package.json brain/package-lock.json brain/mail/render.js brain/mail/render.test.js
git commit -m "粗体发出去还是粗体：正文同时发纯文本和 html"
```

---

### Task 6: 钥匙加一格，发送口开出来

**Files:**
- Modify: `brain/mail/auth.js:31`（SCOPES）+ 文件顶部那段注释
- Create: `brain/mail/send.js`
- Test: `brain/mail/send.test.js`
- Modify: `brain/server.js`（路由）
- Modify: `brain/README.md`

**Interfaces:**
- Consumes: Task 4 的 `buildMime/toRaw/newMessageId`、Task 5 的 `renderBody`
- Produces:
  - `assertSameMailbox(authed, profileEmail)` —— 不一致就抛
  - `sendLetter({ gmail, from, fromName, to, subject, body, replyTo, refs, threadId })
     -> { id, threadId, messageId }`

- [ ] **Step 1: 写会失败的测试**

```js
// brain/mail/send.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertSameMailbox, sendLetter } from './send.js'

test('授权的账号跟画像里填的不是同一个，当场拒发', () => {
  assert.throws(() => assertSameMailbox('a@x.com', 'b@y.com'), /不是同一个/)
})

test('大小写和空格不算不一致', () => {
  assert.doesNotThrow(() => assertSameMailbox('A@X.com', ' a@x.com '))
})

test('画像里没填邮箱就别拦——拦了等于没填过画像的人一封都发不出去', () => {
  assert.doesNotThrow(() => assertSameMailbox('a@x.com', null))
})

test('发出去之后交出 gmail id、thread id 和我们自己生成的 Message-ID', async () => {
  const calls = []
  const gmail = { users: { messages: { send: async (a) => {
    calls.push(a); return { data: { id: 'm1', threadId: 't1' } }
  } } } }
  const out = await sendLetter({
    gmail, from: 'me@x.com', fromName: 'Hu Di', to: 'ana@y.org',
    subject: '你好', body: '**在**',
  })
  assert.equal(out.id, 'm1')
  assert.equal(out.threadId, 't1')
  assert.match(out.messageId, /^<[0-9a-f-]{36}@x\.com>$/)
  assert.equal(calls[0].userId, 'me')
  assert.ok(calls[0].requestBody.raw.length > 0)
})

test('给了 threadId 就挂回那一串', async () => {
  const calls = []
  const gmail = { users: { messages: { send: async (a) => {
    calls.push(a); return { data: { id: 'm', threadId: 't9' } }
  } } } }
  await sendLetter({ gmail, from: 'me@x.com', to: 'a@b.c', subject: 's', body: 'b', threadId: 't9' })
  assert.equal(calls[0].requestBody.threadId, 't9')
})

test('超时一律不重试——那封信可能已经出去了', async () => {
  let n = 0
  const gmail = { users: { messages: { send: async () => {
    n++; const e = new Error('socket hang up'); e.code = 'ETIMEDOUT'; throw e
  } } } }
  await assert.rejects(
    () => sendLetter({ gmail, from: 'me@x.com', to: 'a@b.c', subject: 's', body: 'b' }),
    /可能已经发出去了/)
  assert.equal(n, 1, '只许试一次')
})
```

- [ ] **Step 2: 跑一次，确认它红**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: scope 加一格**

`brain/mail/auth.js`：

```js
// 只发不读：send 这个 scope 给不了它读信的能力，读还是靠 readonly 那一格。
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
]
```

同时把文件顶上那段注释改掉——原文说「这个系统本来就发不出信……不给写权限，
这条护栏就不是嘱咐，是结构上做不到」，换成：

```js
// scope 是 gmail.readonly + gmail.send。加了 send 之后这条护栏没有被拆，
// 它被挪了位置：
//
//   以前：这个系统发不出信。
//   现在：**Fairwind 写得出信，但按不了发送键。**
//
// 发送是 send.js 里一个纯 HTTP 函数，**不在模型的工具白名单里**
// （server.js 的 READ_TOOLS / GMAIL_TOOLS 都没有它）。模型够不到它，
// 跟它够不到别条线的文件是同一种「够不到」——结构上做不到，不是嘱咐。
//
// ⚠️ 加了 scope 之后**必须重跑一次 `npm run mail:auth`**。旧 token 里
// 没有这一格，不重授会报 403 insufficient permissions——而那个报错
// 长得不像「你少授权了一格」，很费时间。
```

- [ ] **Step 4: 写发送函数**

```js
// brain/mail/send.js
// 真的把信发出去。**纯 HTTP，一次模型都不过。**
//
// 这一层跟 gmail.js 是同一条分工线：抓取和理解分开，发送和起草也分开。
// 信是模型写的，按下发送键的是他——所以这个函数只被 /mail/send 那个路由调用，
// 而那个路由只被页面上那颗按钮触发。
import { asAuthErrorIfItIs } from './auth.js'
import { buildMime, toRaw, newMessageId } from './mime.js'
import { renderBody } from './render.js'

/**
 * 用错身份发出去的信，连道歉都没处发。
 *
 * 发错人还能补一封「抱歉发错了」；用**另一个账号**发出去的信，对方看到的
 * 是一个陌生地址，而你在自己的已发送里找不到它。所以这一条拦在最前面。
 *
 * 画像里没填邮箱就不拦——拦了等于没填过画像的人一封都发不出去，
 * 那是拿一个配置问题去挡一件真事。
 */
export function assertSameMailbox(authed, profileEmail) {
  const a = String(authed || '').trim().toLowerCase()
  const p = String(profileEmail || '').trim().toLowerCase()
  if (!p) return
  if (a !== p) {
    throw new Error(
      `授权的信箱（${a}）跟画像里填的（${p}）不是同一个。` +
      '要么改画像里那一格，要么在 brain 目录下跑 `npm run mail:auth` 换个账号授权。')
  }
}

/**
 * 发。
 *
 * **一次都不重试。**
 *
 * gmail.js 里那套退避重试对「取」是对的：取失败了再取一次，最坏是多花点时间。
 * 对「发」是错的——一个超时的请求**可能已经发出去了**，重试等于同一封信
 * 发两遍，而收信人那头看到的是你连发两封一模一样的信。
 * 所以这儿宁可把错报到他脸上，让他自己去已发送里看一眼。
 */
export async function sendLetter({
  gmail, from, fromName, to, subject, body,
  replyTo = null, refs = null, threadId = null,
}) {
  const messageId = newMessageId(from)
  const { text, html } = renderBody(body)
  const raw = toRaw(buildMime({
    from, fromName, to, subject, text, html,
    messageId, inReplyTo: replyTo, refs,
  }))

  let data
  try {
    ;({ data } = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, ...(threadId ? { threadId } : {}) },
    }))
  } catch (err) {
    const authed = asAuthErrorIfItIs(err)
    if (authed.name === 'MailAuthError') throw authed
    const code = err?.response?.status ?? err?.code
    if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code) || code >= 500) {
      throw new Error(
        `发的时候断了（${code}）。**这封信可能已经发出去了**——` +
        '去 Gmail 的「已发送」里看一眼再决定要不要重发，别直接再按一次。')
    }
    throw err
  }

  if (!data?.id) throw new Error('Gmail 没回 message id —— 这封信的下落不明，去已发送里看一眼')
  return { id: String(data.id), threadId: String(data.threadId || ''), messageId }
}
```

- [ ] **Step 5: 跑测试，确认绿**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: README 补一段**

`brain/README.md` 的「接上 Gmail」那节末尾加：

```markdown
### 升级到能发信（2026-08-16）

scope 从 `gmail.readonly` 变成 `gmail.readonly + gmail.send`。
**旧的授权里没有 send 那一格**，所以升级之后必须重新授权一次：

    npm run mail:auth

不重授的话，按「发送」会报 403 insufficient permissions —— 那个报错
长得不像「你少授权了一格」，别在别处找原因。
```

- [ ] **Step 7: 提交**

```bash
git add brain/mail/auth.js brain/mail/send.js brain/mail/send.test.js brain/README.md
git commit -m "钥匙加一格 gmail.send：护栏没拆，挪成「写得出信，按不了发送键」"
```

---

### Task 7: 发完当场记账，产出才消失

**Files:**
- Modify: `brain/server.js`（新增 `handleSendMail` + 路由 `POST /mail/send`）
- Test: `brain/send-order.test.js`

**Interfaces:**
- Consumes: Task 6 的 `sendLetter` / `assertSameMailbox`
- Produces: `POST /mail/send { deliverable_id, pursuit_id|contact_id }`
  → `{ ok:true, id, thread_id }`

- [ ] **Step 1: 写会失败的测试（记账顺序）**

```js
// brain/send-order.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { recordSent } from './server-record.js'

const stubDb = (fail = null) => {
  const seen = []
  return { seen, rpc: async (fn, args) => {
    seen.push(fn)
    if (fn === fail) return { data: null, error: { message: '故意坏的' } }
    return { data: {}, error: null }
  } }
}

test('先记账、后删产出——顺序反了会两头空', async () => {
  const db = stubDb()
  await recordSent(db, { ownerKind: 'contact', ownerId: 'c1', deliverableId: 'd1',
    sent: { id: 'm1', threadId: 't1', messageId: '<x@y>' },
    to: 'a@b.c', subject: 's', summary: '一句话', body: '正文', accountId: 'acc1' })
  assert.deepEqual(db.seen, [
    'pa_add_mail', 'pa_mail_headers_upsert', 'pa_claim_contact_thread', 'pa_delete_deliverable',
  ])
})

test('记账失败就不许删产出——信发出去了，那份稿子是唯一的凭据', async () => {
  const db = stubDb('pa_add_mail')
  await assert.rejects(() => recordSent(db, {
    ownerKind: 'contact', ownerId: 'c1', deliverableId: 'd1',
    sent: { id: 'm1', threadId: 't1', messageId: '<x@y>' },
    to: 'a@b.c', subject: 's', summary: null, body: '正文', accountId: 'acc1',
  }), /记账没成/)
  assert.ok(!db.seen.includes('pa_delete_deliverable'))
})

test('没有摘要就退回正文首段——往来里那行绝不能是空的', async () => {
  const db = stubDb()
  const args = []
  db.rpc = async (fn, a) => { args.push([fn, a]); return { data: {}, error: null } }
  await recordSent(db, { ownerKind: 'pursuit', ownerId: 'p1', deliverableId: 'd1',
    sent: { id: 'm', threadId: 't', messageId: '<x@y>' },
    to: 'a@b.c', subject: 's', summary: null,
    body: '第一段说了这件事。\n\n第二段说别的。', accountId: 'acc1' })
  const [, add] = args.find(([fn]) => fn === 'pa_add_mail')
  assert.equal(add.p_content, '第一段说了这件事。')
})
```

- [ ] **Step 2: 跑一次，确认它红**

Run: `npm test`
Expected: FAIL，`Cannot find module './server-record.js'`

- [ ] **Step 3: 写记账函数（单独一个文件，为的是测得了）**

```js
// brain/server-record.js
// 一封信发出去之后，账怎么记。
//
// 单独拆出来只有一个理由：server.js 顶层就 server.listen()，import 一下
// 服务就起来了，于是「顺序对不对」这件事一行测试都写不了。prompt.js
// 当初也是为这个搬出去的。
//
// ══ 顺序不是风格问题 ══════════════════════════════════════════
// **先记账，后删产出。**
// 反过来的话，中间任何一步失败都会两头空：信已经发出去了、产出没了、
// 往来里也没有。那时候这封信在这个系统里等于**从来不存在**——
// 而它已经躺在别人的收件箱里了。这是这套东西能犯的最严重的错。

/** 往来里那行摘要绝不能是空的。模型给了就用它的，没给就退回正文首段。 */
const oneLine = (summary, body) => {
  const s = String(summary || '').trim()
  if (s) return s
  const first = String(body || '').split(/\n\s*\n/)[0].trim()
  return first || '（发了一封信）'
}

const call = async (db, fn, args, what) => {
  const { error } = await db.rpc(fn, args)
  if (error) throw new Error(`${what}：${error.message}`)
}

export async function recordSent(db, {
  ownerKind, ownerId, deliverableId, sent, to, subject, summary, body, accountId,
  replyTo = null, refs = null,
}) {
  // ① 往来里那一条。gmail_message_id 是唯一约束，所以下次全局同步从
  //    「已发送」里再收到这封时会 on conflict 撞掉——去重不用另写。
  await call(db, 'pa_add_mail', {
    p_gmail_message_id: sent.id,
    p_counterpart: to,
    p_role: 'artist',
    p_content: oneLine(summary, body),
    p_body_raw: body,
    ...(ownerKind === 'pursuit' ? { p_pursuit_id: ownerId } : {}),
    p_meta: { subject, to, sent_from: 'fairwind' },
  }, '记账没成')

  // ② 信头。**不能等下次同步再补**——0055 靠这几个头认亲，
  //    这中间对方要是回得快，那封回信就找不到自己的线。
  await call(db, 'pa_mail_headers_upsert', {
    p_rows: [{
      gmail_message_id: sent.id,
      account_id: accountId,
      gmail_thread_id: sent.threadId,
      from_email: null,          // 由调用方在 server.js 里填成已授权那个地址
      to_emails: [to],
      subject,
      sent_at: new Date().toISOString(),
      counterpart_email: to,
      direction: 'out',
      message_id: sent.messageId,
      in_reply_to: replyTo,
      refs: refs || [],
    }],
  }, '记信头没成')

  // ③ 认领这串往来：下次同步跟着它走
  if (sent.threadId) {
    await call(db,
      ownerKind === 'contact' ? 'pa_claim_contact_thread' : 'pa_link_thread',
      ownerKind === 'contact'
        ? { p_contact_id: ownerId, p_thread_id: sent.threadId }
        : { p_pursuit_id: ownerId, p_thread_id: sent.threadId, p_added_by: 'fairwind' },
      '认领往来没成')
  }

  // ④ 到这一步账已经记全了，产出才可以消失。
  await call(db, 'pa_delete_deliverable', { p_id: deliverableId }, '删草稿没成')
}
```

**注意**：`from_email` 在 `recordSent` 里留空，由 `server.js` 传进来
（那儿才拿得到 `whoami()` 的结果）。把它加进参数：签名多一个 `from`，
`from_email: from`。测试里跟着补一个 `from: 'me@x.com'`。

- [ ] **Step 4: server.js 接上路由**

```js
// brain/server.js
import { client as mailClient, whoami } from './mail/auth.js'
import { gmailFor } from './mail/gmail.js'
import { sendLetter, assertSameMailbox } from './mail/send.js'
import { recordSent } from './server-record.js'

// 真发一封信。
//
// **这个口不在模型的工具白名单里**，只有页面上那颗按钮能触发它。
// 「Fairwind 写得出信，但按不了发送键」——那句话是靠这一条兑现的。
async function handleSendMail(body) {
  const { deliverable_id } = body
  const owner = ownerOf(body)
  if (!owner || !deliverable_id) throw new Error('要有 pursuit_id 或 contact_id，外加 deliverable_id')

  const ctx = await loadOwnerContext(owner)
  const d = (ctx.raw.deliverables || []).find((x) => x.id === deliverable_id)
  if (!d) throw new Error('这儿没有这份产出')
  if (d.kind !== 'email') throw new Error('这份产出不是一封信，发不了')
  if (d.status === 'final') throw new Error('已定稿的不走这条路')
  if (!d.body?.trim()) throw new Error('正文是空的，没东西可发')

  const to = String(d.meta?.to || '').trim().toLowerCase()
  if (!to.includes('@')) throw new Error('这份产出上没有收件人——补一个再发')

  const me = await whoami()
  assertSameMailbox(me.address, mailboxOf(ctx.profile))

  const sent = await sendLetter({
    gmail: gmailFor(await mailClient()),
    from: me.address,
    fromName: artistOf(ctx.profile),
    to,
    subject: d.title,
    body: d.body,
    replyTo: d.meta?.reply_to || null,
    refs: d.meta?.reply_to ? [d.meta.reply_to] : null,
    threadId: d.meta?.thread_id || null,
  })

  const { data: accts } = await db.from('v_pa_mail_accounts').select('*').limit(1)
  await recordSent(db, {
    ownerKind: owner.kind === 'contact' ? 'contact' : 'pursuit',
    ownerId: owner.id,
    deliverableId: deliverable_id,
    sent, to, from: me.address,
    subject: d.title,
    summary: d.meta?.summary || null,
    body: d.body,
    accountId: accts?.[0]?.id || null,
    replyTo: d.meta?.reply_to || null,
    refs: d.meta?.reply_to ? [d.meta.reply_to] : null,
  })

  return { ok: true, id: sent.id, thread_id: sent.threadId }
}
```

路由挂在 1192 行附近那组 POST 里，跟 `/gmail-draft` 并排：

```js
  if (req.method === 'POST' && req.url === '/mail/send') {
    return void json(res, await handleSendMail(await readBody(req)))
  }
```

（照那一段现有的写法接，别自造一套错误处理——`needs_auth` / `fix` 那两个字段
前端已经在读了。）

- [ ] **Step 5: 跑测试，确认绿**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add brain/server-record.js brain/send-order.test.js brain/server.js
git commit -m "发完当场记账，账记全了产出才消失"
```

---

### Task 8: 页面上那颗发送键（两段确认）

**Files:**
- Modify: `src/lib/letters.js`（加 `sendLetter`）
- Modify: `src/components/Deliverables.jsx:91-125`
- Modify: `src/components/PersonFocus.jsx:576-600`
- Modify: `src/components/Identity.jsx:17`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 7 的 `POST /mail/send`
- Produces: `sendLetterNow(owner, deliverableId) -> { ok, id, thread_id }`

- [ ] **Step 1: 前端那一层**

```js
// src/lib/letters.js —— 接在 adoptLetter 后面
import { supa, BRAIN } from './backends.js'

/**
 * 真发。走 brain —— 钥匙在它手上，浏览器这头永远拿不到。
 */
export async function sendLetterNow(owner, deliverableId) {
  const r = await fetch(`${BRAIN}/mail/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(owner.pursuitId ? { pursuit_id: owner.pursuitId } : { contact_id: owner.contactId }),
      deliverable_id: deliverableId,
    }),
  })
  const out = await r.json().catch(() => null)
  if (!r.ok || !out || out.error) {
    const err = new Error(out?.error || `HTTP ${r.status}`)
    err.needsAuth = Boolean(out?.needs_auth)
    err.fix = out?.fix || null
    throw err
  }
  return out
}
```

- [ ] **Step 2: 发送键做成两段**

`Deliverables.jsx` 的 `Acts` 里，`isMail` 那一支从「放进草稿箱」改成三颗：
「发送」（主）、「放进 Gmail 草稿箱」（次，留作附件的退路）。发送那颗：

```jsx
  // 两段确认，只防一件事：发错人。
  //
  // 收件人不许藏在折叠里——**发错人是这个功能唯一无法挽回的失败**。
  // 别的都能补：改错字能再发一封，主题不好看下次注意。发给了不该发的人
  // 补不回来。所以那个地址要一直摆在按钮上。
  const [armed, setArmed] = useState(false)
  const to = d.meta?.to

  <button className="b primary" disabled={!to || busy}
    onClick={() => (armed ? send() : setArmed(true))}
    onBlur={() => setArmed(false)}>
    {busy ? '正在发……' : armed ? `确认发给 ${to}` : '发送'}
  </button>
  {!armed && to && <span className="dv-why">发给 {to}</span>}
  {armed && <span className="dv-why warn">按下去信就出去了，撤不回来。</span>}
```

`PersonFocus.jsx` 右栏「要发的信」那一份照同一套改（同样两段、同样把
收件人摆在脸上）。

- [ ] **Step 3: 把过时的话改掉**

- `Deliverables.jsx:97-101` 那段注释和 `dv-why` 里「球权不会跟着翻」——
  球权早在 0058 就是纯手动了，这句话现在是错的。改成说清楚
  「放进草稿箱 = 还没发；发送 = 真出去了，当场记进往来」。
- `PersonFocus.jsx:589` 那条「只建草稿，不发送 —— 不是我们关掉的，是
  Gmail 连接器整套工具里就没有 send」——现在有 send 了，但**模型仍然没有**。
  改成「发送键在你手上：这个口不在模型的工具白名单里」。
- `PersonFocus.jsx:255` 那句 alert 里「系统没有发送这个能力」同上。
- `Identity.jsx:17` 的 hint：「Fairwind 往这个账号的草稿箱里放信。填错了草稿会
  建到别处去。」→ 改成「Fairwind 用这个账号发信。**填的必须是你授权给
  brain 的那个 Gmail**，不一致会当场拒发。」

- [ ] **Step 4: 样式**

`src/styles.css` 里给 `.dv-why.warn` 一条（用现有的警示色，别自造）。

- [ ] **Step 5: 走一遍验收（设计稿最后那节）**

```bash
npm test           # 先确认全绿
cd brain && npm run mail:auth   # ⚠️ 必须重授一次，旧 token 没有 send
npm run dev & npm run brain
```

按设计稿「怎么验收」那九条逐条过。**第 5 条（真发一封）先发给自己**——
拿一个你自己的地址当收件人跑通了，再对着真人发。

- [ ] **Step 6: 提交**

```bash
git add src/lib/letters.js src/components/Deliverables.jsx src/components/PersonFocus.jsx src/components/Identity.jsx src/styles.css
git commit -m "发送键在页面上了：两段确认，收件人一直摆在脸上"
```

---

## 自查

- **设计稿覆盖**：信封（T1、T2）· 收进产出（T3）· 一个所有者一份（T3 的 upsert）·
  scope + 不给模型（T6）· 身份校验（T6）· MIME + 线程头（T4）· 两种正文（T5）·
  当场记账 + 顺序 + 去重（T7）· 产出消失（T7）· 两段确认（T8）·
  失败原样留着（T6 抛错 + T7 顺序）· 不重试（T6）· 球权不动（全程没碰 ball）·
  附件退路（T8 保留草稿箱那颗按钮）。
- **v1 不做的**：附件、批量、抄送、撤回窗口——计划里一个任务都没有，对。
- **命名一致**：`extractLetter` / `stripTag` / `buildMime` / `toRaw` / `newMessageId` /
  `renderBody` / `sendLetter`（brain）/ `sendLetterNow`（前端，避免跟 brain 那个重名）/
  `assertSameMailbox` / `recordSent` / `pa_adopt_letter` —— 前后一致。
