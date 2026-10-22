# 「这条线在等什么」施工计划（第二稿）

**稿子**：[docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md](../specs/2026-08-19-what-this-line-is-waiting-on-design.md)
——**先读稿子**，尤其第四节转移表和第十一节四条真线。计划里每个判断
单元对应转移表的一格，格子的原话在稿子里，不在这儿重抄。

**一句话**：state × event 的转移表。每次判断存成锚在那条事实上的标签；
state 现算；到点才起草。

**指代**（同稿子）：**你** = Di Hu；**对方** = 线另一头的真人；**Fairwind** = agent。

**全局约束**

- `producer` schema 不在 Supabase Exposed schemas 里——前端只能读 `public.v_pa_*`、
  只能写 `public` 的 SECURITY DEFINER RPC。`db().from(...)` 会静默返回空。
- PostgREST 一次最多 1000 行且不报错。可能超的读走 RPC 或分页。
- 下一个迁移号：**0092**。
- 存的每一条锚在不会变的事实上；state 不落表。
- brain 走订阅额度，每次 `query()` 底价约 $0.19——省钱靠少调用。
  转移表是省钱的结构：**大多数 event 只触发一格的一个问题**，不是全量重判。
- 改判据先扫再改（`pg_get_viewdef` / `pg_get_functiondef` 过正则）。

---

## Task 1 · 标签表：一条事实身上挂它引发的判断

**文件**：新建 `supabase/migrations/0092_a_fact_carries_its_tags.sql`

- [ ] **Step 1**：建表。锚在 `pursuit_messages.id`（信、笔、见面、决定本来就
      并排在这张表里，一套锚点全盖住）。

```sql
create table if not exists producer.message_tags (
  message_id   uuid primary key references producer.pursuit_messages(id) on delete cascade,
  -- 这次判断是转移表的哪一格问出来的，例 'WAITING_REPLY x THEIR_LETTER'
  situation    text not null,
  -- 答案（哪格用哪些列，其余留 null）：
  resolves     boolean,      -- 解决了当时等的事吗（关闭 WAITING_REPLY 的唯一途径）
  resolves_why text,
  needs_reply  boolean,
  reply_why    text,         -- 判「要回」的凭什么 —— 通知栏要显示
  awaiting     text,         -- 这封信发出后在等对方做什么
  wait_days    int,          -- 按这类事的惯例该等几天（agent 定，5/14 兜底）
  meet_at      timestamptz,  -- 约的日子
  gist         text,         -- 一句话梗概，通知栏直接用
  tagged_at    timestamptz not null default now(),
  tagged_by    text not null default 'fairwind',
  -- 日期和理由成对，孤儿字段挡在门口（教训来自「你定的日子 8/17」）
  constraint tags_paired check (
    (awaiting is null or wait_days is not null) and
    (needs_reply is not true or reply_why is not null) and
    (resolves is not true or resolves_why is not null))
);
```

- [ ] **Step 2**：RPC `public.pa_tag_message(...)`，upsert，字段 `lower/btrim`
      清洗照抄 `pa_mail_headers_upsert` 的写法（**别重写，去读 0087 原文**）
- [ ] **Step 3**：验约束——只给 `p_awaiting` 不给 `p_wait_days`，必须报
      `tags_paired`
- [ ] **Step 4**：提交

---

## Task 2 · 机会线卡片补「记一笔」

联系人卡片有（`PersonFocus.jsx:578`），机会线卡片没有。NOTE 是转移表里
的一个 event，线上没入口，表就缺一列。

**文件**：`supabase/migrations/0093_a_line_can_be_noted.sql`、`src/lib/chat.js`、
`src/components/PursuitFocus.jsx`

- [ ] **Step 1**：RPC `pa_add_pursuit_note(p_pursuit_id, p_text, p_kind)`，
      kind 只认 `note|meet|decision`，写完 `perform pa_recompute_touch(...)`
- [ ] **Step 2**：`chat.js` 加 `addPursuitNote()`；`PursuitFocus.jsx` 底部输入框
      旁加「记一笔」，抄 `PersonFocus.jsx:528-584` 那一组
- [ ] **Step 3**：手测——记一笔进时间线，「上次碰」更新
- [ ] **Step 4**：提交

---

## Task 3 · state 现算

**文件**：`supabase/migrations/0094_state_is_replayed.sql`

- [ ] **Step 1**：视图 `public.v_pa_state`——每个 subject（contact|pursuit）
      **至多一行**：`state`（八种之一）、`what`（在等什么/该做什么那句话）、
      `since_at`、`due_at`、`anchor_id`。
      算法：取该 subject 最新一条「起了个 state」的标签
      （awaiting→WAITING_REPLY，needs_reply→NEEDS_REPLY，meet_at→MEETING_SET…），
      再看它之后有没有关掉它的标签或事实：
      - `WAITING_REPLY` 只被 `resolves=true` 的标签关（**对方回信这个事实
        本身不关**——第一稿的错就在这，「收到回头看」不许关）
      - `NEEDS_REPLY` 被「回了那件事」的标签关，或任何一条 NOTE 关
      - `MEETING_SET` 到点自动变 `DEBRIEF`（时间比较，纯规则）
- [ ] **Step 2**：`due_at <= now()` → 附带列 `zone='due'`，否则 `'waiting'`
- [ ] **Step 3**：SQL 测试，**CultureHub 是第一个用例**：手工插入稿子
      第十一节那四条标签，断言 8/14 之后视图里这条线是
      `WAITING_REPLY / 等 Mattie 介绍 Joo / due 9/1`，且 8/11 那条不出现
- [ ] **Step 4**：`pa_selfcheck()` 加断言：每 subject 至多一行；
      `message_tags` 里没有孤儿字段
- [ ] **Step 5**：提交

---

## Task 4 · 判断分发器：一格一个问题

**文件**：`brain/judge.js`（新建）、`brain/judge.test.js`（新建）、
`brain/mail/addr.js`、`brain/server.js`

- [ ] **Step 1**：清洗层先加日历回执（Valeria 那封 `Accepted:` 空信的教训）：

```js
const CALENDAR = /^(Accepted|Declined|Tentative|Canceled|Cancelled|Invitation|Updated invitation):/i
```

  测试先红：`Accepted: Di Hu's Zoom Meeting` → null；
  `Re: proposal accepted?` → 真信。

- [ ] **Step 2**：分发器骨架。每收进一条新事实（信/笔）：

```js
// 一格一个问题。问什么取决于当时的 state 和来的 event —— 这就是第一稿
// 被推倒的原因：它对每封信问同样四件事。
const state = await stateOf(subject)          // 读 v_pa_state
const cell  = TRANSITIONS[state.state]?.[event]   // 稿子第四节的那张表
if (!cell) { log(`  · ${who}：${state.state} 遇到 ${event}，表里没这格，跳过`); return }
const tag = await cell.judge({ fact, state })     // 只问这一格的问题
await rpc('pa_tag_message', { p_message_id: fact.id, p_situation: `${state.state} x ${event}`, ...tag })
```

- [ ] **Step 3**：逐格实现 judge，prompt 用稿子第四节的**原话**。每格一个
      解析函数 + 测试（成对校验抄 `parseRejudge`：日期和理由缺一个就两个都丢）：
      - `IDLE × THEIR_LETTER`（三连判）
      - `IDLE × MY_LETTER`（等什么、惯例等几天）
      - `WAITING_REPLY × THEIR_LETTER`（解决了吗 a/b/c——**b 客套不关**）
      - `WAITING_REPLY × MY_LETTER`（换掉等的事了吗，due 不重置）
      - `WAITING_REPLY × NOTE`、`NEEDS_REPLY × MY_LETTER`（回了那件事吗）、
        `NEEDS_REPLY × NOTE`（纯规则，不花钱）、`NEEDS_REPLY × THEIR_LETTER`（合并梗概）、
        `MEETING_SET × THEIR_LETTER`（改期/取消）
- [ ] **Step 4**：**跳过要出声**：表里没有的格、判不出来的，逐条写日志
- [ ] **Step 5**：接进 `server.js` 5 分钟循环，`sweepMail()` 之后
- [ ] **Step 6**：`npm test`（343 起步），提交

---

## Task 5 · TIMER：到点的四种

**文件**：`brain/timer.js`（新建）、`brain/draft.js`（新建）、`brain/server.js`

- [ ] **Step 1**：`timerPass()` 每轮扫 `v_pa_state`：
      - `WAITING_REPLY` 到 due → 起草 follow-up（草稿走现成的 `[[LETTER]]`
        机制发进卡），同时问出下一轮的 awaiting/wait_days
      - `MEETING_SET` 当天早上 → 「记得今天见面」；结束时刻 → 换
        「今天见面怎么样？」并在卡里发问 → `DEBRIEF`
      - `OWE_MEETING_NOTE` 挂上 48 小时没动 → 该动的
- [ ] **Step 2**：`NEEDS_REPLY` 进入时判「信息够吗」：够→起草进卡；
      不够→卡里问你（`INFO_NEEDED`），`YOUR_ANSWER` 下一轮起草
- [ ] **Step 3**：范围闸门：机会线的卡都起草；人这边只对 2026-08-03 后建的线
- [ ] **Step 4**：测试——`zone='waiting'` 的一条草稿都不许起
- [ ] **Step 5**：提交

---

## Task 6 · DEBRIEF 的产出链和 OWE_*

**文件**：`brain/judge.js` 追加、`supabase` 需要的话加介绍人字段的读面

- [ ] **Step 1**：`DEBRIEF × YOUR_ANSWER`：答案存成 kind='meet' 的笔；
      两个判断（单人/对公；有介绍人吗、这算介绍后第一次真联系上吗）
- [ ] **Step 2**：`OWE_THANKS` 触发（被介绍人**回了信或见了面**才算，
      只发出没人回不算）；草稿进**介绍人**的联系人卡
- [ ] **Step 3**：合并：同一人多个理由/多件事 → 问「等一起发还是先发一封」，
      合进**后发生 event** 的卡，早的卡留一句说明。
      测试用例就是 Weidi：两条介绍一封谢信；【已处理】关 `NEEDS_REPLY`
      时 `OWE_THANKS` 不许被带走
- [ ] **Step 4**：提交

---

## Task 7 · 通知栏两个区 + 人际管理页恢复「该动的」

**文件**：`src/lib/notifications.js`、`src/components/Notifications.jsx`、
`src/components/People.jsx`、测试

- [ ] **Step 1**：分栏规则一个函数：

```js
// 机会线的事进通知栏，人的事进人际管理页。判据是挂在哪张卡上：
// 只挂在联系人身上、放不进任何线的，即便是 NEEDS_REPLY 也进人际管理页。
export const goesTo = s => s.subject_kind === 'pursuit' ? 'bell' : 'people'
```

- [ ] **Step 2**：两栏各两个区：该动的（zone='due'）/ 等待（折叠，数字露着）。
      同一份 `v_pa_state` 的两个切片，不是两个列表
- [ ] **Step 3**：通知文本用稿子里的**原文**；`NEEDS_REPLY` 行显示 `reply_why`
- [ ] **Step 4**：🔔 数全部四层
- [ ] **Step 5**：【已处理】= 调 `pa_add_pursuit_note`（人卡调对应的），
      **不是** cue_marks——留痕迹；【不再提醒】（只有归不到线的孤儿提醒有）
      才用 cue_marks，只关提醒不动信
- [ ] **Step 6**：测试：Sarah 的 9/28 在等待区不在该动的；`npm test`；提交

---

## Task 8 · 卡面金色字

**文件**：卡封面组件

- [ ] **Step 1**：读 `v_pa_state`，封面显示 `what · due`，金色，跟球权并排
- [ ] **Step 2**：手测 CultureHub：只剩「等 Mattie 九月初把 Joo 介绍给你 · 9/1」
- [ ] **Step 3**：提交

---

## Task 9 · 老邮件重放（2026-08-03 起）

**文件**：`brain/replay.js`（新建，一次性）

- [ ] **Step 1**：先数——多少 subject、多少条事实、预计多少次调用，
      **报出来等确认再跑**（这是唯一一处停下来问的）
- [ ] **Step 2**：按时间顺序过转移表打标签；**重放期间不起草**
      （重放完，到点的自然由 Task 5 的 TIMER 接手）
- [ ] **Step 3**：重放完跑第十一节四条真线的核对（Task 10 Step 2）
- [ ] **Step 4**：提交

---

## Task 10 · 验收

- [ ] **Step 1**：`pa_selfcheck()` 补：每 subject 至多一行；
      due 超过 1 天的都有草稿；`waiting` 区没有草稿
- [ ] **Step 2**：**四条真线逐行对**（稿子第十一节）：CultureHub 四步、
      Sarah 的 9/28、Weidi 链五步、Valeria 全程 IDLE——重放结果和表格
      逐行贴出来对
- [ ] **Step 3**：稿子第十二节 14 条验收逐条走，结果贴出来
- [ ] **Step 4**：`pg_get_viewdef`/`pg_get_functiondef` 扫一遍，确认旧的
      五种由头没有第二处还在用
- [ ] **Step 5**：提交
