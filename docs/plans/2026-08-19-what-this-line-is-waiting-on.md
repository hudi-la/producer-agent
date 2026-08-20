# 「这条线在等什么」施工计划

**稿子**：[docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md](../specs/2026-08-19-what-this-line-is-waiting-on-design.md)

**一句话**：把五种由头合成一个状态机；agent 的判断存成**信的标签**，
线的状态**现算**；「做完了」的证据从往来里读出来去关掉等待。

**架构**：标签锚在 `producer.pursuit_messages.id` 上 —— 那张表里
**信（email）、笔（note）、见面（meet）、决定（decision）本来就并排放着**，
所以一套标签同时盖住「信里说的」和「你手记的」，不用第二套机制。
状态由视图从标签现算，不落表。

**全局约束**

- `producer` schema **不在 Supabase Exposed schemas 里** —— 前端只能读
  `public.v_pa_*` 视图、只能写 `public` 的 SECURITY DEFINER RPC。
  `db().from('pursuit_messages')` 会**静默返回空**，不报错。
- PostgREST **一次最多 1000 行，而且不报错**。任何可能超的读都要分页或走 RPC。
- 下一个迁移号：**0092**。
- **能算出来的就算，算不出来的才存。** 存的每一条必须锚在一个不会变的事实上。
- brain 走 Claude 订阅额度（没有 API key）。每次 `query()` 底价约 $0.19，
  跟载荷大小无关 —— **省钱靠少调用，不靠少给上下文**。
- 改判据先扫再改：`pg_get_viewdef` / `pg_get_functiondef` 过一遍正则，
  确认没有第二处用同一个判据。这条规矩是从「一个地方修了四次」来的。

---

## Task 1 · 标签表

**文件**：新建 `supabase/migrations/0092_a_fact_carries_its_tags.sql`

标签锚在一条不变的事实上。`letter_verdicts` 保留不动（它锚在
`gmail_message_id` 上，是同一个思路的先例），新表锚在 `pursuit_messages.id`，
因为笔和见面没有 gmail id。

- [ ] **Step 1**：写迁移

```sql
-- 一条事实（一封信、一条笔、一次见面）身上挂的判断。
-- 锚在 pursuit_messages.id 上：信的内容永远不变，所以判一次永远算数。
-- 这是「存」的全部；线的状态从这些标签现算，不落表。
create table if not exists producer.message_tags (
  message_id   uuid primary key references producer.pursuit_messages(id) on delete cascade,
  -- 我发的信：在等对方做什么、合理该等多久
  awaiting     text,                    -- 「等他回复能不能排明年的课」；null = 不等什么
  wait_days    int,                     -- agent 起草时定的，不是全局的 [7,21]
  -- 来的信：要不要回
  needs_reply  boolean,
  reply_why    text,                    -- **判「要回」的理由，要显示出来**
  -- 任何一条：约了什么日子
  meet_at      timestamptz,             -- 见面/通话约定的时间
  -- 任何一条：它把之前哪个等待解决了
  resolves     boolean default false,   -- 「素材前天交了」这种
  resolves_why text,
  gist         text,                    -- 一句话梗概，通知栏直接用
  tagged_at    timestamptz not null default now(),
  tagged_by    text not null default 'fairwind'
);
create index if not exists message_tags_meet on producer.message_tags(meet_at)
  where meet_at is not null;

-- 日期和理由必须成对 —— 这条规矩是从 pa_set_next_touch 学来的：
-- 只有日子没有出处，界面就得自己编一个（真出过「你定的日子 8/17」这种事）。
alter table producer.message_tags add constraint tags_paired check (
  (awaiting is null or wait_days is not null) and
  (needs_reply is not true or reply_why is not null) and
  (resolves is not true or resolves_why is not null)
);
```

- [ ] **Step 2**：写 RPC

```sql
create or replace function public.pa_tag_message(
  p_message_id uuid, p_awaiting text default null, p_wait_days int default null,
  p_needs_reply boolean default null, p_reply_why text default null,
  p_meet_at timestamptz default null, p_resolves boolean default false,
  p_resolves_why text default null, p_gist text default null,
  p_by text default 'fairwind'
) returns void language sql security definer set search_path = producer, public as $$
  insert into producer.message_tags as t
    (message_id, awaiting, wait_days, needs_reply, reply_why,
     meet_at, resolves, resolves_why, gist, tagged_by)
  values (p_message_id, nullif(btrim(p_awaiting),''), p_wait_days,
          p_needs_reply, nullif(btrim(p_reply_why),''), p_meet_at,
          coalesce(p_resolves,false), nullif(btrim(p_resolves_why),''),
          nullif(btrim(p_gist),''), p_by)
  on conflict (message_id) do update set
    awaiting = excluded.awaiting, wait_days = excluded.wait_days,
    needs_reply = excluded.needs_reply, reply_why = excluded.reply_why,
    meet_at = excluded.meet_at, resolves = excluded.resolves,
    resolves_why = excluded.resolves_why, gist = excluded.gist,
    tagged_at = now(), tagged_by = excluded.tagged_by;
$$;
grant execute on function public.pa_tag_message(uuid,text,int,boolean,text,timestamptz,boolean,text,text,text) to anon, authenticated;
```

- [ ] **Step 3**：跑迁移，验约束真的挡得住

```bash
# 只有 awaiting 没有 wait_days —— 应该报错
psql "$DB" -c "select public.pa_tag_message('<某条真 message id>'::uuid, p_awaiting=>'等回复');"
# 期望：new row violates check constraint "tags_paired"
```

- [ ] **Step 4**：提交

---

## Task 2 · 机会线卡片补上「记一笔」

联系人卡片有（`PersonFocus.jsx:578`），机会线卡片**没有** ——
只有 `pa_set_jot` 那个卡上便签，不进时间线。线下发生的事没地方记，
系统就永远只知道邮件里发生的事。

**文件**：`supabase/migrations/0093_a_line_can_be_noted.sql`（新建）、
`src/lib/chat.js`、`src/components/PursuitFocus.jsx`

- [ ] **Step 1**：RPC —— 往 `pursuit_messages` 写一条 `kind='note'`

```sql
create or replace function public.pa_add_pursuit_note(
  p_pursuit_id uuid, p_text text, p_kind text default 'note'
) returns uuid language plpgsql security definer set search_path = producer, public as $$
declare v_id uuid;
begin
  if coalesce(btrim(p_text),'') = '' then raise exception '空的笔不记'; end if;
  if p_kind not in ('note','meet','decision') then
    raise exception '记一笔只认 note/meet/decision，收到 %', p_kind;
  end if;
  insert into producer.pursuit_messages (pursuit_id, kind, role, content, created_at)
  values (p_pursuit_id, p_kind, 'note', btrim(p_text), now())
  returning id into v_id;
  perform public.pa_recompute_touch(p_pursuit_id);   -- 记一笔算一次「碰」
  return v_id;
end $$;
grant execute on function public.pa_add_pursuit_note(uuid,text,text) to anon, authenticated;
```

- [ ] **Step 2**：`src/lib/chat.js` 加 `addPursuitNote(pursuitId, text, kind)`
- [ ] **Step 3**：`PursuitFocus.jsx` 底部输入框旁边加「记一笔」按钮，
      抄 `PersonFocus.jsx:528-584` 那一组（含悬停说明）
- [ ] **Step 4**：手测 —— 记一笔之后时间线上出现，卡的「上次碰」更新
- [ ] **Step 5**：提交

---

## Task 3 · 状态现算

**文件**：`supabase/migrations/0094_what_is_this_line_waiting_on.sql`（新建）

一条线 / 一个人**只有一个当前状态**。从标签算，不落表。

- [ ] **Step 1**：视图 `public.v_pa_waiting`

每个 subject（contact | pursuit）一行：

| 列 | 怎么来的 |
|---|---|
| `subject_kind` / `subject_id` | |
| `kind` | `reply_out`（等对方）/ `reply_in`（等你回）/ `meet` / `thanks` / `after_meet` |
| `since_at` | 触发那条事实的时间 |
| `due_at` | `since_at + wait_days`；`meet` 用 `meet_at` |
| `what` | `awaiting` / `reply_why` / 见面的事由 —— **要显示的那句话** |
| `state` | `due_at <= now()` → `'due'`，否则 `'waiting'` |
| `anchor_id` | 那条 `pursuit_messages.id`，做记号用 |

关键逻辑 —— **什么关掉一个等待**（稿子第七节）：

```sql
-- 取每个 subject 最新的那条「起了个等待」的事实，
-- 然后看它之后有没有出现「解决了它」的事实。
-- 注意：只有**对方的**信、或者**你记的笔**能解决「等对方回」；
-- 你自己又发一封不算 —— 否则连发三封等于永远等不到点。
where not exists (
  select 1 from producer.pursuit_messages m2
   join producer.message_tags t2 on t2.message_id = m2.id
  where m2.pursuit_id = w.pursuit_id
    and m2.created_at > w.since_at
    and m2.deleted_at is null
    and (t2.resolves                                  -- 往来里说了「做完了」
      or (w.kind = 'reply_out' and m2.role <> 'artist' and t2.needs_reply is not null)
      or m2.kind in ('note','meet','decision'))       -- 你记了一笔
)
```

- [ ] **Step 2**：`public.v_pa_line_state` —— 每条线一行，给卡面那行金色字用
      （`what` ＋ `due_at`；没有等待就没有这一行）
- [ ] **Step 3**：写测试 —— **CultureHub 必须是第一个用例**

```sql
-- 8/12 那封信打上 resolves=true（「素材前天交了」）
-- → 8/11 那个等待在 v_pa_waiting 里消失
-- → 9/1「等 Mattie 介绍 Joo」还在，state='waiting'
```

- [ ] **Step 4**：`pa_selfcheck()` 加断言 ——
      每个 subject 在 `v_pa_waiting` 里**至多一行**
- [ ] **Step 5**：提交

---

## Task 4 · 收信之后打标签

**文件**：`brain/tag.js`（新建）、`brain/server.js`、`brain/tag.test.js`（新建）

范围（稿子第八节）：**只对归进了现有机会卡片 / 联系人卡片的新信打**。

- [ ] **Step 1**：清洗那一层先加上日历回执 —— `brain/mail/addr.js`

```js
// 主题以这些开头的是日历回执，正文往往是空的。
// 真例：`Accepted: Di Hu's Zoom Meeting` 正文空，模型盯着空正文
// 编了个「可能漏附件，得问一句」，于是它变成了「他回你了」。
const CALENDAR = /^(Accepted|Declined|Tentative|Canceled|Cancelled|Invitation|Updated invitation):/i
```

- [ ] **Step 2**：写测试，先红

```js
test('日历回执不是有信息的信', () => {
  assert.equal(classify({ subject: "Accepted: Di Hu's Zoom Meeting", body: '' }), null)
})
test('主题里带 Accepted 但不在开头的，是真信', () => {
  assert.ok(classify({ subject: 'Re: proposal accepted?', body: '...' }))
})
```

- [ ] **Step 3**：`brain/tag.js` —— 一次一封，问四件事

问什么（**不要问的**：他的全部作品、机构的全部背景 —— 判这四件事用不上）：

```
【这封信】方向、谁、主题、正文（去引用后，截到 240 字）
【这条线在等什么】（从 v_pa_waiting 拿，可能是空的）
【这条线最近三条往来】只要日期和一句梗概

判四件事，最后一行输出：
[[TAG]] {"gist":"…",
         "needs_reply":true|false, "reply_why":"凭什么要回 —— 这句会显示给他看",
         "awaiting":"在等对方做什么|null", "wait_days":5,
         "meet_at":"2026-09-11T12:00:00-07:00|null",
         "resolves":true|false, "resolves_why":"它解决了上面那个等待，凭什么"}
```

- [ ] **Step 4**：`parseTag()` ＋ 成对校验（**日期和理由必须一起有，否则两个都丢**
      —— 抄 `brain/rejudge.js` 的 `parseRejudge`），写测试
- [ ] **Step 5**：接进 `brain/server.js` 的 5 分钟循环，`sweepMail()` 之后
- [ ] **Step 6**：**判不出来要出声** —— 跳过的写日志，不静默

```js
log(`  · 跳过 ${skipped.length} 封：${skipped.map(s => `${s.who}（${s.why}）`).join('、')}`)
```

- [ ] **Step 7**：`npm test`（现在 343 个），提交

---

## Task 5 · 到点才起草

**文件**：`brain/draft.js`（新建）、`brain/server.js`

**到点那一刻才起草**，不是判断出来就起草 —— 等 5 天那封，
第 5 天才动笔，中间对方回了那笔钱就省了。

- [ ] **Step 1**：`draftPass()` —— 读 `v_pa_waiting` 里 `state='due'`
      **且还没有草稿**的，每条一次调用
- [ ] **Step 2**：信息不全的分支（稿子第五节第 2 条）——
      够 → 直接起草；不够 → **先在卡里问你**，你答了下一轮再起草
- [ ] **Step 3**：草稿走现成的 `[[LETTER]]` 机制（`brain/letter.js` 已经有
      `extractLetter`，`brain/letter.test.js` 有 5 个用例），发进那张卡的对话
- [ ] **Step 4**：起草的同时把 `wait_days` 写回标签 ——
      **等多久是起草那一刻定的**，不是全局的 `[7,21]`
- [ ] **Step 5**：测试 —— `state='waiting'` 的一条都不起草
- [ ] **Step 6**：提交

---

## Task 6 · 通知栏：该动的 / 等待

**文件**：`src/lib/notifications.js`、`src/components/Notifications.jsx`、
`src/lib/notifications.test.js`

- [ ] **Step 1**：`loadNotifications()` 改读 `v_pa_waiting`，
      按 `state` 分成两组。**同一份数据的两个切片，不是两个列表。**
- [ ] **Step 2**：UI 两个区

```
该动的  （3）      ← state='due'
等待    （12）  ▸  ← state='waiting'，折叠，数字一直露在外面
```

- [ ] **Step 3**：**🔔 上那个数字数全部**（该动的 ＋ 等待 ＋ 老账 ＋ 判为不用回），
      不只数「该动的」。一个把 89 条藏在后面的数字，跟这一整刀要治的病是同一种。
- [ ] **Step 4**：每条显示 `what`（就是判「要回」的那句理由）—— 现在完全不显示
- [ ] **Step 5**：**[ 已处理 ]** 按钮 = 调 `pa_add_pursuit_note` 记一笔
      （联系人的调对应的），**不是** `cue_marks`。留痕迹，不是抹掉。
- [ ] **Step 6**：归不到任何线的那条提醒配 **[ 不再提醒 ]** ——
      这个才用 `cue_marks`，**只关提醒，不动信**
- [ ] **Step 7**：`npm test`，提交

---

## Task 7 · 人际管理页恢复「该动的」

**文件**：`src/components/People.jsx`（或对应文件）、`src/lib/notifications.js`

> 这一步撤回 8/19 早些时候的一刀。**这次不同**：两栏装的是不同的事，
> 不是同一件事的两个位置。

- [ ] **Step 1**：分栏规则写成一个函数，不是散在两处

```js
// 机会线的事进通知栏，人的事进人际管理页。
// 判据是**这件事挂在哪张卡上**，不是它长什么样：
// 只存在于联系人卡片、放不进任何机会线的事，即便看起来是「需要回信」，
// 也进人际管理页。
export const goesTo = w => w.subject_kind === 'pursuit' ? 'bell' : 'people'
```

- [ ] **Step 2**：人际管理页的「该动的」＋「等待」两个区，跟通知栏同一套组件
- [ ] **Step 3**：**合并** —— 同一个人身上两件事只出现一次，在**后发生**的那张卡上。
      「后发生」按稿子第五节：由 agent 判**这件事该等 follow-up 时间一起发，
      还是可以先发一封**，把结论写进 `awaiting`
- [ ] **Step 4**：测试 —— 造一个「Biayna 要回谢 ＋ Weidi 要回信」的局面，
      断言**两栏加起来只出现一次**
- [ ] **Step 5**：提交

---

## Task 8 · 卡面上那行金色字

**文件**：`src/components/PursuitCard.jsx`（或封面对应文件）

- [ ] **Step 1**：读 `v_pa_line_state`，在封面上显示一行金色的「在等什么」
- [ ] **Step 2**：跟球权那两个按钮**并排，不互相覆盖** ——
      球权是你随手记的便签，系统不读它；这行是系统算出来的。
      **两个不一致，就让你看见不一致。**
- [ ] **Step 3**：手测 CultureHub —— 应该只剩「等 Mattie 九月初介绍 Joo · 9/1」，
      8/11 那条不再显示
- [ ] **Step 4**：提交

---

## Task 9 · 老邮件补判

**文件**：`brain/backfill-tags.js`（新建，一次性脚本）

范围（稿子第十节）：**2026-08-03 之后**（第一张机会卡建立那天）的往来。
更早的只归属、不补计时 —— 2024 年发出去没人回的，补一条
「已经过去 700 天，follow up 已起草」没意义，而且会一次性起草几十封信。

- [ ] **Step 1**：先数清楚要判多少封、多少个对象，**报出来再动手**
- [ ] **Step 2**：分批打标签，**只打标签，不起草**
      （起草归 Task 5 的 `draftPass`，按到点日自然发生）
- [ ] **Step 3**：跑完对一遍 —— `v_pa_waiting` 里有没有 due_at 在 2026-08-03 之前的
- [ ] **Step 4**：提交

---

## Task 10 · 自查和验收

- [ ] **Step 1**：`pa_selfcheck()` 加这几条
      - 每个 subject 在 `v_pa_waiting` 里至多一行
      - `message_tags` 里没有「有 awaiting 没 wait_days」的
      - `state='due'` 且超过 1 天的，都有草稿
- [ ] **Step 2**：`npm test` 全绿，`pa_selfcheck()` / `pa_selfcheck_reads()` 全绿
- [ ] **Step 3**：**改判据先扫再改**的收尾 —— 拿
      `pg_get_viewdef` / `pg_get_functiondef` 搜一遍，确认没有第二处还在用旧的五种由头
- [ ] **Step 4**：把稿子第十二节那 14 条**逐条走一遍**，结果贴出来
- [ ] **Step 5**：提交

---

## 验收（抄自稿子第十二节）

1. **CultureHub**：8/11 那个截止不再显示为待办 ——
   因为你 8/12 的信里说了「素材前天交了」。9/1 那条还在。
2. 发出一封要材料的信 → 「等待」栏出现一条，写着设定的 follow up 日子
3. 对方回了信但没答那件事 → **等待不取消**
4. 你自己又发了一封 → **等待不取消**
5. 对方回信答了 → 等待关掉，以最新那封为起点重判
6. 到点那天 → 挪进「该动的」，**这时候才有草稿**
7. 信息不全的 → 先在卡里问你，答了才起草
8. 机会线卡片上记一笔「今天打电话说定了」→ 相关等待关掉
9. 按「已处理」→ 等于记了一笔，**痕迹留在时间线上**
10. 回谢 / 见面 48 小时信 **在人际管理页**，不在通知栏
11. 同一个人身上两件事 **只出现一次**
12. 🔔 = 四层加起来
13. 卡封面有一行金色的「在等什么」，跟球权并排
14. 2026-08-03 之前的往来不补 follow-up 计时
