# 顶栏通知 · 施工计划

> **给执行的人：** 用 superpowers:subagent-driven-development（推荐）或
> superpowers:executing-plans 一个任务一个任务地做。步骤用 `- [ ]` 勾。

**目标：** 顶栏一个 🔔，点开是一条一条需要你动的事——机会线和人混在一起，
按事实现算，办完了自己就没了。

**做法：** 库出一张**只有标量的事实视图**（一行一个对象），JS 拿这一行拼由头。
由头一条都不存；存的只有三样关于不变事实的记录：一封信要不要回、你打的卡、
你说的先不看。

**技术栈：** Supabase（`producer` schema + `public` 视图）· Node（brain，`node --test`）
· React + Vite

**设计稿：** [`docs/specs/2026-08-18-notifications-design.md`](../specs/2026-08-18-notifications-design.md)

## 全局约束

- **测试跑法：`npm test`。它只扫三个 glob：`src/lib/*.test.js`、`brain/*.test.js`、
  `brain/mail/*.test.js`。新测试必须落在这三处**，否则永远不会被跑到。
- **日期一律走 `src/lib/when.js`**——`day(x)` 出 `'2026-08-18'`，`md(x)` 出 `'8/18'`。
  全 app 只有那一份，不许在别处再写一个。
- **凡是读 `pursuit_messages` 的地方都要带 `deleted_at is null`**（0066 的规矩：
  「重说」撤掉的行还在库里，读面一律滤掉）。
- **迁移照 0025 的规矩**：`create or replace function` 必须整段重写，
  不许只写差异——漏掉 `security definer` 或 `set search_path` 会悄悄改掉权限模型，
  且不报错。
- **视图一律建在 `public`**，表建在 `producer`。前端只读 `public` 的 `v_pa_*`。
  建完要 `grant select ... to anon, authenticated, service_role`。
- **判不出来的时候一律当「要回」。** 模型没答上、格式不对、网断了——宁可多吵一条，
  绝不许把一封真信悄悄咽掉。
- **筛掉的东西必须数得出来、点得开。** 静默藏起来是这个项目最不能忍的那种谎。
- 迁移编号从 **0072** 起（现有最大 0071）。
- 模型的工具白名单（`brain/server.js` 的 `READ_TOOLS` / `GMAIL_TOOLS`）**一个字都不加**。

---

### Task 1: 事实视图 —— 一行一个对象，只有标量

**Files:**
- Create: `supabase/migrations/0072_cue_facts.sql`

**Interfaces:**
- Produces: 视图 `public.v_pa_cue_facts`，一行一个对象。列见下。
  Task 2、6 全靠这一行。

这一步拦的是 `loadPursuits.js` 开头记的那次事故：全库消息拉进浏览器，
PostgREST 封顶 1000 行，超了只给最老的 1000 条、静悄悄不报错。
所以**信不进浏览器，只有标量进**。

- [ ] **Step 1: 写迁移**

```sql
-- supabase/migrations/0072_cue_facts.sql
--
-- 由头要用的事实，一行一个对象（人 / 机会线），全是标量。
--
-- 为什么是视图不是前端算：loadPursuits.js 开头记着那次事故——为了算红点
-- 每 8 秒把全库消息拉一遍，PostgREST 封顶 1000 行，超了只返回**最老的**
-- 1000 条，新消息静悄悄不在里面而且不报错。
--
-- 为什么判据不搬进 SQL：那样 cues.js 和视图就是两套实现，而 SQL 那份没测试
-- （这个仓库的测试只跑 node --test）。分工是硬的：**库供事实，JS 拼由头**。
--
-- 设计稿：docs/specs/2026-08-18-notifications-design.md 第四·五节

create or replace view public.v_pa_cue_facts as
with 信 as (
  -- 机会线的往来：只算「算这条线的」那些（0052/0053/0055 的 on_this_line 推导）
  select 'pursuit'::text as subject_kind, v.pursuit_id as subject_id,
         v.role, v.created_at, v.gmail_message_id, v.who, h.subject
    from public.v_pa_pursuit_mail v
    join producer.pursuit_messages m on m.id = v.id and m.deleted_at is null
    left join producer.mail_headers h on h.gmail_message_id = v.gmail_message_id
   where v.on_this_line and v.kind = 'email'
  union all
  -- 人的往来：挂在这个人名下、有 gmail id 的那些。
  -- **没有 gmail_message_id 的不算往来**——那是你跟 Fairwind 的商量，
  -- 拿它当往来算，等待期会被你自己的一句嘀咕重置掉（cues.js 的老规矩）。
  select 'contact'::text, m.contact_id,
         m.role, m.created_at, m.gmail_message_id,
         coalesce(c.name, m.counterpart_email), h.subject
    from producer.pursuit_messages m
    left join producer.contacts c on c.id = m.contact_id
    left join producer.mail_headers h on h.gmail_message_id = m.gmail_message_id
   where m.contact_id is not null and m.gmail_message_id is not null
     and m.deleted_at is null and m.kind = 'email'
), 进来的 as (
  select subject_kind, subject_id, max(created_at) as at
    from 信 where role = 'org' group by 1, 2
), 最后一封进来的 as (
  select i.subject_kind, i.subject_id, i.at,
         x.gmail_message_id, x.who, x.subject
    from 进来的 i
    join lateral (
      select s.gmail_message_id, s.who, s.subject from 信 s
       where s.subject_kind = i.subject_kind and s.subject_id = i.subject_id
         and s.role = 'org' and s.created_at = i.at limit 1) x on true
), 出去的 as (
  select subject_kind, subject_id, max(created_at) as at
    from 信 where role = 'artist' group by 1, 2
), 没回音的 as (
  -- 你连着发出去、中间没人回的最后几封。对方一回，这一串就断了。
  select s.subject_kind, s.subject_id, count(*)::int as n, max(s.created_at) as at
    from 信 s
    left join 进来的 i
      on i.subject_kind = s.subject_kind and i.subject_id = s.subject_id
   where s.role = 'artist' and s.created_at > coalesce(i.at, '-infinity'::timestamptz)
   group by 1, 2
), 见过面 as (
  select m.contact_id as subject_id, max(m.created_at) as at
    from producer.pursuit_messages m
   where m.contact_id is not null and m.role = 'note' and m.kind = 'meet'
     and m.deleted_at is null
   group by 1
)
select
  x.subject_kind, x.subject_id, x.name, x.line_title,
  fin.at            as last_in_at,
  fin.gmail_message_id as last_in_id,
  fin.who           as last_in_from,
  fin.subject       as last_in_subject,
  fout.at           as last_out_at,
  coalesce(run.n, 0) as unanswered_n,
  run.at            as unanswered_at,
  x.next_touch_at, x.next_touch_why, x.deadline_at,
  x.intro_by_name, x.intro_thanked_at, x.checkin_at,
  (fin.at is not null) as org_ever_replied,
  meet.at           as last_meet_at,
  coalesce(meet.at is not null and fout.at > meet.at, false) as met_followed_up
from (
  select 'pursuit'::text as subject_kind, p.id as subject_id,
         coalesce(p.contact_name, p.org, '') as name,
         p.title as line_title,
         p.next_touch_at, p.next_touch_why, p.deadline_at,
         null::text as intro_by_name, null::date as intro_thanked_at,
         null::date as checkin_at
    from public.v_pa_pursuits p
  union all
  select 'contact', c.id, coalesce(c.name, ''), null,
         c.next_touch_at, c.next_touch_why, null::date,
         ib.name, c.intro_thanked_at,
         case when c.last_touch_src = 'checkin' then c.last_touch_at end
    from producer.contacts c
    left join producer.contacts ib on ib.id = c.intro_by
) x
left join 最后一封进来的 fin
  on fin.subject_kind = x.subject_kind and fin.subject_id = x.subject_id
left join 出去的 fout
  on fout.subject_kind = x.subject_kind and fout.subject_id = x.subject_id
left join 没回音的 run
  on run.subject_kind = x.subject_kind and run.subject_id = x.subject_id
left join 见过面 meet
  on x.subject_kind = 'contact' and meet.subject_id = x.subject_id;

grant select on public.v_pa_cue_facts to anon, authenticated, service_role;

comment on view public.v_pa_cue_facts is
  '由头要用的事实，一行一个对象，全是标量。信不进浏览器（1000 行封顶那次事故）；判据在 cues.js';
```

- [ ] **Step 2: 跑迁移**

用 Supabase MCP 对项目 `jjgvvtrsnoqnoigukobi` 应用这支迁移。

- [ ] **Step 3: 查证 —— 每一列都得有真值**

跑这三条，逐条对着真库看：

```sql
-- ① 行数 = 机会线数 + 人数，一个不多一个不少
select subject_kind, count(*) from public.v_pa_cue_facts group by 1;

-- ② 有往来的对象，进出两边的日期都得对得上
select subject_kind, name, last_in_at::date, last_in_from, last_out_at::date,
       unanswered_n, unanswered_at::date
  from public.v_pa_cue_facts
 where last_in_at is not null or last_out_at is not null
 order by greatest(coalesce(last_in_at, '-infinity'), coalesce(last_out_at, '-infinity')) desc
 limit 20;

-- ③ 没回音那一串：随便挑一个 unanswered_n >= 1 的，回去数原始信核对
select * from public.v_pa_cue_facts where unanswered_n >= 1 order by unanswered_at desc limit 5;
```

预期：
- ① 两种 kind 都有，数字跟 `select count(*) from producer.pursuits` /
  `producer.contacts` 一致
- ② `last_in_at` 晚于 `last_out_at` 的那些，就是「他回你了你还没回」
- ③ `unanswered_n` = 最后一封对方来信**之后**你发出去的封数；
  没有对方来信的话就是你发出去的总数

- [ ] **Step 4: 提交**

```bash
git add supabase/migrations/0072_cue_facts.sql
git commit -m "由头要用的事实出一张视图：一行一个对象，信不进浏览器"
```

---

### Task 2: `cues.js` 改吃事实行（判据一条不改）

**Files:**
- Modify: `src/lib/cues.js`（整个重写）
- Modify: `src/lib/cues.test.js`（整个重写）

**Interfaces:**
- Consumes: Task 1 的 `v_pa_cue_facts` 一行
- Produces:
  - `cuesFor(facts, { today }) -> Cue[]`，`Cue = { via, at, why, stopped? }`
  - `cueKey(facts, cue) -> string`，形如 `pursuit|<uuid>|replied|2026-08-16`
  - `BUMP_WAIT = [7, 21]`、`MEET_HOURS = 48`

**这一步只换入口，判据一条不加。** 新判据在 Task 5。

- [ ] **Step 1: 重写测试（会失败）**

```js
// src/lib/cues.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cuesFor, cueKey, BUMP_WAIT, MEET_HOURS } from './cues.js'

const T = (s) => new Date(s + 'T12:00:00Z')

// 一行事实。给多少写多少 —— 不用再造一串假邮件了。
const facts = (o = {}) => ({
  subject_kind: 'contact', subject_id: 'c1', name: 'Maisa',
  line_title: null, last_in_at: null, last_in_id: null, last_in_from: null,
  last_in_subject: null, last_out_at: null, unanswered_n: 0, unanswered_at: null,
  next_touch_at: null, next_touch_why: null, deadline_at: null,
  intro_by_name: null, intro_thanked_at: null, checkin_at: null,
  org_ever_replied: false, last_meet_at: null, met_followed_up: false,
  ...o,
})
const via = (cs, v) => cs.find((c) => c.via === v)

// ── 他回你了 ────────────────────────────────────────────────
test('他回了你 —— 带日期带天数', () => {
  const cs = cuesFor(facts({ last_in_at: T('2026-08-06').toISOString(),
                             last_out_at: T('2026-08-01').toISOString() }),
                     { today: T('2026-08-09') })
  assert.equal(cs[0].via, 'replied')            // 球在你手上，排第一
  assert.ok(cs[0].why.includes('8/6'))
  assert.ok(cs[0].why.includes('3 天'))
})

test('他刚回，当天 —— 提，但不说「0 天」', () => {
  const c = via(cuesFor(facts({ last_in_at: T('2026-08-09').toISOString() }),
                        { today: T('2026-08-09') }), 'replied')
  assert.ok(c.why.includes('还没回'))
  assert.equal(c.why.includes('0 天'), false)
})

test('你已经回了 —— 最后一封是你的，这条就不提了', () => {
  const cs = cuesFor(facts({ last_in_at: T('2026-08-06').toISOString(),
                             last_out_at: T('2026-08-07').toISOString() }),
                     { today: T('2026-08-09') })
  assert.equal(via(cs, 'replied'), undefined)
})

test('打过卡「聊过了」，而且在这封信之后 —— 不再挂着', () => {
  const cs = cuesFor(facts({ last_in_at: T('2026-08-06').toISOString(),
                             checkin_at: '2026-08-07' }),
                     { today: T('2026-08-09') })
  assert.equal(via(cs, 'replied'), undefined)
})

test('打卡在这封信之前 —— 还得回', () => {
  const cs = cuesFor(facts({ last_in_at: T('2026-08-06').toISOString(),
                             checkin_at: '2026-08-05' }),
                     { today: T('2026-08-09') })
  assert.ok(via(cs, 'replied'))
})

// ── 该碰了 ──────────────────────────────────────────────────
test('发出去满 7 天没回音 —— 第 1 次碰', () => {
  const c = via(cuesFor(facts({ unanswered_n: 1, unanswered_at: T('2026-08-01').toISOString(),
                                last_out_at: T('2026-08-01').toISOString() }),
                        { today: T('2026-08-08') }), 'bump')
  assert.ok(c.why.includes('第 1 次碰'))
  assert.ok(c.why.includes('7 天'))
})

test('才过 6 天 —— 还不催', () => {
  const c = via(cuesFor(facts({ unanswered_n: 1, unanswered_at: T('2026-08-01').toISOString() }),
                        { today: T('2026-08-07') }), 'bump')
  assert.equal(c, undefined)
})

test('碰满三次 —— 停了，但不许消失', () => {
  const c = via(cuesFor(facts({ unanswered_n: 3, unanswered_at: T('2026-06-01').toISOString() }),
                        { today: T('2026-08-09') }), 'bump')
  assert.equal(c.stopped, true)
  assert.ok(c.why.includes('停了'))
})

// ── 说好的日子 ──────────────────────────────────────────────
test('到日子了 —— 日期说得出出处', () => {
  const c = via(cuesFor(facts({ next_touch_at: '2026-08-01',
                                next_touch_why: '他说 "circle back next semester"' }),
                        { today: T('2026-08-09') }), 'circleback')
  assert.ok(c.why.includes('circle back next semester'))
  assert.ok(c.why.includes('8/1'))
})

test('日子还没到 —— 不提', () => {
  const c = via(cuesFor(facts({ next_touch_at: '2026-09-01' }), { today: T('2026-08-09') }),
                'circleback')
  assert.equal(c, undefined)
})

// ── 回谢介绍人 ──────────────────────────────────────────────
test('聊上了还没回谢 —— 提', () => {
  const c = via(cuesFor(facts({ intro_by_name: 'Tom', org_ever_replied: true,
                                last_in_at: T('2026-08-06').toISOString() }),
                        { today: T('2026-08-09') }), 'thanks')
  assert.ok(c.why.includes('Tom'))
})

test('只发出去没人回 —— 谈不上聊上了，不提', () => {
  const c = via(cuesFor(facts({ intro_by_name: 'Tom', org_ever_replied: false }),
                        { today: T('2026-08-09') }), 'thanks')
  assert.equal(c, undefined)
})

// ── 见面 48 小时信 ──────────────────────────────────────────
test('见完没发信 —— 提；过了 48 小时改口但不消失', () => {
  const c = via(cuesFor(facts({ last_meet_at: T('2026-08-01').toISOString() }),
                        { today: T('2026-08-09') }), 'met')
  assert.ok(c.why.includes(String(MEET_HOURS)))
})

test('见完发过信了 —— 不提', () => {
  const c = via(cuesFor(facts({ last_meet_at: T('2026-08-01').toISOString(),
                                met_followed_up: true }),
                        { today: T('2026-08-09') }), 'met')
  assert.equal(c, undefined)
})

// ── 键 ──────────────────────────────────────────────────────
test('键锚在事实的日期上，不是措辞上', () => {
  const f = facts({ last_in_at: T('2026-08-06').toISOString() })
  const k1 = cueKey(f, via(cuesFor(f, { today: T('2026-08-09') }), 'replied'))
  const k2 = cueKey(f, via(cuesFor(f, { today: T('2026-08-20') }), 'replied'))
  assert.equal(k1, k2)                          // 「3 天」变「14 天」，键不变
  assert.equal(k1, 'contact|c1|replied|2026-08-06')
})

test('他再回一封新的 —— 键变了，这条理应重新出现', () => {
  const a = facts({ last_in_at: T('2026-08-06').toISOString() })
  const b = facts({ last_in_at: T('2026-08-18').toISOString() })
  const ka = cueKey(a, via(cuesFor(a, { today: T('2026-08-20') }), 'replied'))
  const kb = cueKey(b, via(cuesFor(b, { today: T('2026-08-20') }), 'replied'))
  assert.notEqual(ka, kb)
})

test('BUMP_WAIT 还是那两个数', () => {
  assert.deepEqual(BUMP_WAIT, [7, 21])
})
```

- [ ] **Step 2: 跑，确认全红**

```bash
npm test 2>&1 | grep -A3 "cues"
```

预期：一片 FAIL（`cuesFor` 现在要三个参数、拿不到 `facts.last_in_at`）。

- [ ] **Step 3: 重写 `src/lib/cues.js`**

```js
import { md, day as dayOf, today as todayStr } from './when.js'

// 由头 —— 「现在为什么该动这个人 / 这条线」。
//
// 设计稿：docs/specs/2026-08-18-notifications-design.md
//
// ══ 这一份不看信 ═══════════════════════════════════════════════
//
// 入口从 cuesFor(contact, msgs, opts) 改成 cuesFor(facts, opts)：
// 它只看 v_pa_cue_facts 的一行标量。理由是 loadPursuits.js 开头那次事故——
// 全库消息拉进浏览器，PostgREST 封顶 1000 行，超了只给最老的 1000 条，
// 静悄悄不报错。**信不进浏览器。**
//
// 判据本身一条没改，只是数据来路换了：
//   unansweredRun(msgs).length  →  facts.unanswered_n
//   「最后一封是对方的」        →  facts.last_in_at > facts.last_out_at
//
// ══ 老规矩，一条都还算数 ═══════════════════════════════════════
//
// **「多久没碰」不是引擎，「由头」才是。** 冷却时间只决定先找谁，
// 不足以让你动笔。在美国，纯问候（just checking in）是公认最没用的邮件；
// 有效的 keep-in-touch 一定带一个由头。
//
// **能算出来的就算，算不出来的才存。** 存下来的东西会跟事实分叉，
// 算出来的不会。这里全是纯函数。
//
// 日期一律走 lib/when.js —— **全 app 只有那一份**，按你住的地方（洛杉矶）算。

const DAY = 86400000

/**
 * 差几天。**按当地的日子算，不按毫秒**——傍晚记的一笔不该算成明天。
 * 两边都先落到 'YYYY-MM-DD' 再减。
 */
const daysSince = (from, to) => {
  const a = dayOf(from), b = dayOf(to)
  if (!a || !b) return null
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / DAY)
}

/** 美国那条公认的 follow-up 节奏：约一周后碰一次，再等两三周，第三次不回就停。 */
export const BUMP_WAIT = [7, 21]

/** 见完面那封 follow-up 的时限。过了不消失，只是改口。 */
export const MEET_HOURS = 48

/**
 * 他回你了，你还没回。**最常发生、也最要紧的一条。**
 *
 * 判据：最后一封进来的比最后一封出去的晚。你回了，出去的就在后面了。
 *
 * 怎么算办完了：你回信（下次算自然就不响了），或者你按「聊过了」打个卡
 * ——有些信本来就不用回（「谢谢，回头见」），别让它一直挂着。
 */
function repliedCue(f, today) {
  if (!f.last_in_at) return null
  if (f.last_out_at && new Date(f.last_out_at) > new Date(f.last_in_at)) return null
  // 打过卡说处理过了，而且是在这封信之后 —— 不再吵你
  if (f.checkin_at && f.checkin_at >= dayOf(f.last_in_at)) return null
  const d = daysSince(f.last_in_at, today)
  return {
    via: 'replied', at: dayOf(f.last_in_at),
    why: d <= 0 ? `${md(f.last_in_at)} 他回你了，还没回`
       : `${md(f.last_in_at)} 他回你了，${d} 天没回`,
  }
}

function bumpCue(f, today) {
  if (!f.unanswered_n || !f.unanswered_at) return null
  const bumps = f.unanswered_n - 1          // 第一封不算「碰」
  // 碰满了：**不进手头，但也不许消失**。
  // 消失 = 你以为系统还在管，其实它早放弃了 —— 那是「红点撒谎」的同一件事。
  if (bumps >= BUMP_WAIT.length) {
    return {
      via: 'bump', stopped: true, at: dayOf(f.unanswered_at),
      why: `已经碰过 ${bumps} 次，停了（最后一次 ${md(f.unanswered_at)}）`,
    }
  }
  const waited = daysSince(f.unanswered_at, today)
  if (waited < BUMP_WAIT[bumps]) return null
  return {
    via: 'bump', at: dayOf(f.unanswered_at),
    why: `${md(f.unanswered_at)} 发出去，${waited} 天没回音（第 ${bumps + 1} 次碰）`,
  }
}

// 「circle back next semester」在美国语境里**是真话**——是真的邀请你在那个
// 时间点再来一次。婉拒长的是另一个样子（not a fit at this time），而且
// **不给时间锚点**。0011 那份迁移里记着两条真事：LACHSA 和 Ruth Asawa SOTA
// 都给了锚点，都因为没人记得再碰而飘掉了。
function circlebackCue(f, today) {
  if (!f.next_touch_at) return null
  if (f.next_touch_at > dayOf(today)) return null
  return {
    via: 'circleback', at: f.next_touch_at,
    // 日期永远说得出出处：要么是对方的原话，要么是你自己定的。没有第三种。
    why: f.next_touch_why
      ? `${f.next_touch_why} → ${md(f.next_touch_at)} 到了`
      : `你定的日子到了（${md(f.next_touch_at)}）`,
  }
}

// Warm intro 的闭环：过阵子单独回介绍人一句「跟他聊了，谢谢」。
// 大多数人不做这一步，做了的人会一直有人愿意给他介绍。
//
// 但**得等对方真回过你**：只发出去没人回，谈不上「聊上了」。
function thanksCue(f) {
  if (!f.intro_by_name || f.intro_thanked_at) return null
  if (!f.org_ever_replied) return null
  return {
    via: 'thanks', at: dayOf(f.last_in_at),
    why: `跟 ${f.name || '他'} 聊上了，还没回谢 ${f.intro_by_name}`,
  }
}

// Opening / artist talk / conference 是美国 networking 的主场，
// 见完 48 小时内那封 follow-up 不发，那次见面基本等于没发生。
//
// 48 小时**不是延迟，是过期提示**：过了也不消失，只是改口。
// 让它消失就等于替你决定放弃了。
function metCue(f, today) {
  if (!f.last_meet_at || f.met_followed_up) return null
  const hrs = Math.floor((new Date(today) - new Date(f.last_meet_at)) / 3600000)
  return {
    via: 'met', at: dayOf(f.last_meet_at),
    why: hrs > MEET_HOURS
      ? `${md(f.last_meet_at)} 见的，已经过 ${MEET_HOURS} 小时了，follow-up 还没发`
      : `${md(f.last_meet_at)} 见过，48 小时信还没发`,
  }
}

/**
 * 这一行事实上现在有哪些由头。
 *
 * today 传得进来是为了测试能写死，也为了列表算一次给所有行用——
 * 免得渲染到一半跨过午夜，前后两半用两个「今天」。
 */
export function cuesFor(f, { today = new Date() } = {}) {
  return [
    // 「他回你了」排第一：球在你手上的时候，别的都是次要的
    repliedCue(f, today),
    bumpCue(f, today),
    circlebackCue(f, today),
    thanksCue(f),
    metCue(f, today),
  ].filter(Boolean)
}

/**
 * 一条由头的**身份**：哪个对象 + 哪一种 + 依据哪天的事实。
 *
 * 关掉/勾掉要存下来，就得有个稳定的键。不能拿 why 当键——
 * 「3 天没回」明天变成「4 天没回」，你今天关掉的明天又冒出来。
 * 拿 at（依据那条事实的日期）当键就对了：**他再回你一封新的，
 * at 就变了，这条由头理应重新出现**——那是新事实，不是你关过的那条。
 */
export const cueKey = (f, cue) =>
  `${f.subject_kind}|${f.subject_id}|${cue.via}|${cue.at || ''}`
```

- [ ] **Step 4: 跑，确认全绿**

```bash
npm test
```

预期：全 PASS。

- [ ] **Step 5: 让老调用点先编译得过**

`cues.js` 换了签名，两处旧调用会炸。这一步只做**最小改动让页面不白屏**，
真正的删除在 Task 8。

- `src/components/People.jsx:49` 和 `src/components/PersonFocus.jsx:141`
  各自把 `cuesFor(...)` 那一行改成 `[]`，上面加一行注释：

```js
// 由头挪去顶栏通知了（Task 6/7）。这儿先空着，Task 8 整块删掉。
const cues = []
```

- [ ] **Step 6: 眼睛看一眼**

```bash
npm run dev
```

打开人际管理页：**「现在该动的」变成空，别的一切照旧，控制台没红字。**

- [ ] **Step 7: 提交**

```bash
git add src/lib/cues.js src/lib/cues.test.js src/components/People.jsx src/components/PersonFocus.jsx
git commit -m "由头改吃一行事实：信不再进浏览器，判据一条没改"
```

---

### Task 3: 两张表 —— 信的判定、你的记号

**Files:**
- Create: `supabase/migrations/0073_letter_verdicts_and_cue_marks.sql`

**Interfaces:**
- Produces:
  - 表 `producer.letter_verdicts`、`producer.cue_marks`
  - 视图 `public.v_pa_letter_verdicts`、`public.v_pa_cue_marks`
  - RPC `public.pa_judge_letter(p_gmail_message_id, p_needs_reply, p_not_before, p_why)`
  - RPC `public.pa_mark_cue(p_kind, p_id, p_via, p_at, p_mark)` — `p_mark` 传
    `'done' | 'off' | null`（`null` = 撤销）
  - RPC `public.pa_unmark_all_off()` — 只放回 ✕ 的，不动 ✓

- [ ] **Step 1: 写迁移**

```sql
-- supabase/migrations/0073_letter_verdicts_and_cue_marks.sql
--
-- 通知栏要存的**全部**东西，就这两张表。由头本身一条都不存（现算）。
-- 存的每一样都是**关于一个不会变的事实的**记录：
--   letter_verdicts —— 关于那一封信的内容，而信寄出去就不会再改
--   cue_marks       —— 关于某一条由头的身份（谁+哪种+依据哪天）
--
-- 设计稿：docs/specs/2026-08-18-notifications-design.md 第五、七、九节

-- ══ 一、这封信要不要回 ════════════════════════════════════════
--
-- 判一次、永远算数 —— 跟 address_verdicts（0045）是同一种东西。
-- 它跟 next_action 那种「全局现在该干什么」根本不是一回事：
-- 那种判断新事实一来就分叉，这种不会，因为信的内容永远不变。
create table if not exists producer.letter_verdicts (
  gmail_message_id text primary key
    references producer.mail_headers(gmail_message_id) on delete cascade,
  needs_reply  boolean not null,
  not_before   date,           -- 要回，但不是现在（从他信里读出来的日子）
  why          text not null,  -- 一句人话，你看得见它凭什么这么判
  judged_at    timestamptz not null default now()
);

comment on table producer.letter_verdicts is
  '一封信要不要回、什么时候回。判一次永远算数——信的内容不会变，所以这个判断不会过期';

-- ══ 二、你按的 ✓ 和 ✕ ═════════════════════════════════════════
--
-- 为什么 ✕ 也上库（cueoff.js 原来存 localStorage）：8/08 那次事故
-- ——两个窗口同时开着同一个 localhost，顶栏「过卡」一个 1/2 一个 1/1，
-- 两份存储各记各的、刷新不会收敛。pa_seen 因此进了库；pa_cue_off 是
-- 同一个形状的地雷。通知栏一旦是唯一入口，踩到它的代价更大。
--
-- 键锚在**事实的日期**上，不是措辞上（cues.js 的 cueKey）：
-- 「3 天没回」明天变「4 天没回」，拿措辞当键的话今天关掉的明天又冒出来。
create table if not exists producer.cue_marks (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references producer.profile(id),
  subject_kind text not null check (subject_kind in ('contact', 'pursuit')),
  subject_id   uuid not null,
  via          text not null,
  fact_at      date not null,
  mark         text not null check (mark in ('done', 'off')),
  marked_at    timestamptz not null default now(),
  unique (profile_id, subject_kind, subject_id, via, fact_at)
);

comment on table producer.cue_marks is
  'done=办完了 / off=先不看。分开存是为了「都放回来」只放回 off，不翻出真办完的';

-- profile_id 恒等于那唯一一行 profile。带上它不是为了今天，是为了以后
-- 真有第二个人时不用拆表（pursuit_seen 同一个做法）。

-- ══ 三、读面 ═══════════════════════════════════════════════════
create or replace view public.v_pa_letter_verdicts as
  select gmail_message_id, needs_reply, not_before, why, judged_at
    from producer.letter_verdicts;

create or replace view public.v_pa_cue_marks as
  select subject_kind, subject_id, via, fact_at, mark, marked_at
    from producer.cue_marks;

grant select on public.v_pa_letter_verdicts to anon, authenticated, service_role;
grant select on public.v_pa_cue_marks       to anon, authenticated, service_role;

-- ══ 四、写口 ═══════════════════════════════════════════════════
create or replace function public.pa_judge_letter(
  p_gmail_message_id text, p_needs_reply boolean,
  p_not_before date, p_why text)
returns boolean
language plpgsql
security definer
set search_path = public, producer
as $$
begin
  -- 信不在账本里就不判 —— 不许凭空造一行判定出来
  if not exists (select 1 from producer.mail_headers
                  where gmail_message_id = p_gmail_message_id) then
    return false;
  end if;
  insert into producer.letter_verdicts
              (gmail_message_id, needs_reply, not_before, why)
       values (p_gmail_message_id, p_needs_reply, p_not_before,
               coalesce(nullif(trim(p_why), ''), '（没说理由）'))
  on conflict (gmail_message_id) do update
     set needs_reply = excluded.needs_reply,
         not_before  = excluded.not_before,
         why         = excluded.why,
         judged_at   = now();
  return true;
end $$;

create or replace function public.pa_mark_cue(
  p_kind text, p_id uuid, p_via text, p_at date, p_mark text)
returns boolean
language plpgsql
security definer
set search_path = public, producer
as $$
declare v_profile uuid;
begin
  select id into v_profile from producer.profile limit 1;
  if v_profile is null then return false; end if;

  if p_mark is null then                       -- 撤销
    delete from producer.cue_marks
     where profile_id = v_profile and subject_kind = p_kind
       and subject_id = p_id and via = p_via and fact_at = p_at;
    return true;
  end if;

  insert into producer.cue_marks
              (profile_id, subject_kind, subject_id, via, fact_at, mark)
       values (v_profile, p_kind, p_id, p_via, p_at, p_mark)
  on conflict (profile_id, subject_kind, subject_id, via, fact_at) do update
     set mark = excluded.mark, marked_at = now();
  return true;
end $$;

-- 「都放回来」**永远留这条路**：关掉是看不见，看不见不许等于没有。
-- 只放回 off —— 你按错了 ✕ 能全捞回来，而不会把真办完的一起翻出来。
create or replace function public.pa_unmark_all_off()
returns integer
language plpgsql
security definer
set search_path = public, producer
as $$
declare n integer;
begin
  with gone as (delete from producer.cue_marks where mark = 'off' returning 1)
  select count(*) into n from gone;
  return n;
end $$;

grant execute on function public.pa_judge_letter(text, boolean, date, text)
  to anon, authenticated, service_role;
grant execute on function public.pa_mark_cue(text, uuid, text, date, text)
  to anon, authenticated, service_role;
grant execute on function public.pa_unmark_all_off()
  to anon, authenticated, service_role;
```

- [ ] **Step 2: 跑迁移**

用 Supabase MCP 应用到 `jjgvvtrsnoqnoigukobi`。

- [ ] **Step 3: 查证三个 RPC**

```sql
-- 判定：假 id 打不进来
select public.pa_judge_letter('不存在的id', true, null, '试试');   -- 预期 false
-- 真 id 打得进来（挑一封真信）
select public.pa_judge_letter(
  (select gmail_message_id from producer.mail_headers where direction='in' limit 1),
  false, null, '他说的是「谢谢，回头见」');                          -- 预期 true
select * from public.v_pa_letter_verdicts;                          -- 预期 1 行

-- 记号：打上、改掉、撤销
select public.pa_mark_cue('contact',
  (select id from producer.contacts limit 1), 'replied', '2026-08-16', 'off');
select public.pa_mark_cue('contact',
  (select id from producer.contacts limit 1), 'replied', '2026-08-16', 'done');
select mark from public.v_pa_cue_marks;                             -- 预期 done（覆盖了）
select public.pa_unmark_all_off();                                  -- 预期 0（done 不动）
select count(*) from public.v_pa_cue_marks;                         -- 预期 1
select public.pa_mark_cue('contact',
  (select id from producer.contacts limit 1), 'replied', '2026-08-16', null);
select count(*) from public.v_pa_cue_marks;                         -- 预期 0
```

- [ ] **Step 4: 提交**

```bash
git add supabase/migrations/0073_letter_verdicts_and_cue_marks.sql
git commit -m "通知栏要存的全部东西：一封信要不要回、你按的 ✓ 和 ✕"
```

---

### Task 4: brain 判信 —— 一次判一批

**Files:**
- Create: `brain/triage.js`
- Create: `brain/triage.test.js`
- Modify: `brain/server.js`（加一条路由 `/letters/triage`）

**Interfaces:**
- Consumes: Task 3 的 `pa_judge_letter`
- Produces:
  - `parseTriage(text) -> Array<{ id, needs_reply, not_before, why }>` —— 纯函数，
    解析失败返回 `[]`
  - `triagePrompt(letters) -> string` —— `letters` 是
    `[{ id, from, subject, body, at }]`
  - HTTP `POST /letters/triage`，body `{ ids: string[] }`，
    回 `{ judged: number, failed: number }`

- [ ] **Step 1: 写会失败的测试**

```js
// brain/triage.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTriage, triagePrompt } from './triage.js'

test('摘出一批判定', () => {
  const raw = `我看了这三封。

[[TRIAGE]] [{"id":"a1","needs_reply":true,"not_before":null,"why":"她问你三月能不能来一周，等你答"},{"id":"b2","needs_reply":false,"not_before":null,"why":"「谢谢，回头见」，没有要你答的事"},{"id":"c3","needs_reply":true,"not_before":"2027-01-15","why":"他说 circle back next semester"}]`
  const out = parseTriage(raw)
  assert.equal(out.length, 3)
  assert.equal(out[0].id, 'a1')
  assert.equal(out[0].needs_reply, true)
  assert.equal(out[1].needs_reply, false)
  assert.equal(out[2].not_before, '2027-01-15')
})

test('格式不对 —— 空数组，不猜', () => {
  assert.deepEqual(parseTriage('我觉得都得回。'), [])
  assert.deepEqual(parseTriage('[[TRIAGE]] 不是 json'), [])
})

test('缺字段的那条丢掉，别的照收 —— 一封坏的不带塌一批', () => {
  const raw = '[[TRIAGE]] [{"id":"a1","needs_reply":true,"why":"要答"},{"needs_reply":false,"why":"没 id"}]'
  const out = parseTriage(raw)
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'a1')
  assert.equal(out[0].not_before, null)      // 没给就是 null
})

test('not_before 不是日子的话当没给', () => {
  const raw = '[[TRIAGE]] [{"id":"a1","needs_reply":true,"not_before":"下学期","why":"x"}]'
  assert.equal(parseTriage(raw)[0].not_before, null)
})

test('提示词里每封信都在，而且带得出 id', () => {
  const p = triagePrompt([
    { id: 'a1', from: 'Sarah', subject: '驻地', body: '三月能来一周吗？', at: '2026-08-16' },
    { id: 'b2', from: 'Tom', subject: 'Re: 谢谢', body: '谢谢，回头见。', at: '2026-08-15' },
  ])
  assert.ok(p.includes('a1'))
  assert.ok(p.includes('b2'))
  assert.ok(p.includes('三月能来一周吗'))
  assert.ok(p.includes('[[TRIAGE]]'))
})
```

- [ ] **Step 2: 跑，确认失败**

```bash
npm test 2>&1 | grep -A3 triage
```

预期：FAIL —— `Cannot find module './triage.js'`。

- [ ] **Step 3: 写 `brain/triage.js`**

```js
// 这封信要不要回。
//
// 这是三层漏斗的**第三层**。前两层已经建好了（0045）：
//   ① mail_headers.bulk —— 信头里就看得出的群发 / no-reply，零成本
//   ② address_verdicts  —— 这个地址是不是真人，一地址一次
// 第三层要判的是真人写给你的、但**不需要你回**的那些：
// 「谢谢，回头见」「收到了，月底再联系」。
//
// 为什么这个判断可以存下来：它只关于**那一封信的内容**，而信的内容永远不变。
// 跟 next_action 那种「全局现在该干什么」根本不是一回事——那种新事实一来就分叉。
//
// 设计稿：docs/specs/2026-08-18-notifications-design.md 第五、六节

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * 从回复里摘出那一批判定。**解析不出来一律空数组**——
 * 空数组的下场是「这批没判成，下次打开重判」，而不是「判成了不用回」。
 */
export function parseTriage(text) {
  const m = String(text || '').match(/\[\[TRIAGE\]\]\s*(\[[\s\S]*\])\s*$/)
  if (!m) return []
  let rows
  try { rows = JSON.parse(m[1]) } catch (_) { return [] }
  if (!Array.isArray(rows)) return []
  return rows
    // 缺 id 或缺 needs_reply 的丢掉。**一封坏的不带塌一批。**
    .filter((r) => r && typeof r.id === 'string' && typeof r.needs_reply === 'boolean')
    .map((r) => ({
      id: r.id,
      needs_reply: r.needs_reply,
      // 不是 'YYYY-MM-DD' 就当没给 —— 「下学期」进不了 date 列
      not_before: typeof r.not_before === 'string' && ISO_DAY.test(r.not_before)
        ? r.not_before : null,
      why: typeof r.why === 'string' && r.why.trim() ? r.why.trim() : '（没说理由）',
    }))
}

/** 一封信在提示词里长什么样。正文截断，够判就行。 */
const CUT = 1200
const one = (l) => `--- id: ${l.id}
${l.at || '?'} ${l.from || '对方'}：${l.subject || '（无主题）'}
${String(l.body || '').slice(0, CUT)}`

/**
 * 一次判一批。**一次请求判 N 封，比 N 次请求判 1 封便宜一个数量级。**
 */
export function triagePrompt(letters) {
  return `下面是 ${letters.length} 封刚收到的信。每一封只答两个问题。

问题一：这封信**需要你回**吗？
需要回 = 里面有等你答的事（问题、邀约、要材料、约时间）。
不需要回 = 客套收尾（「谢谢，回头见」）、单纯的确认（「收到了」）、
通知类的告知。**拿不准就算需要回**——漏一封真信比多吵一条坏得多。

问题二：需要回的话，**是不是现在**？
他信里明说了时间锚点（「circle back next semester」「月底再联系」），
就给一个 YYYY-MM-DD；没说就 null。**日子必须是他信里说的**，不许你编。

${letters.map(one).join('\n\n')}

**最后一行**单独输出，别的什么都不要加：
[[TRIAGE]] [{"id":"<上面那个 id>","needs_reply":true|false,"not_before":"YYYY-MM-DD"|null,"why":"一句话，20 字内，说清凭什么这么判"}]`
}
```

- [ ] **Step 4: 跑，确认全绿**

```bash
npm test
```

- [ ] **Step 5: 接路由**

在 `brain/server.js` 顶部 import 边上加：

```js
import { parseTriage, triagePrompt } from './triage.js'
```

在 `/mail/send` 那一段**之前**插入这条路由：

```js
  // ── 判一批信要不要回 ─────────────────────────────────────────
  //
  // 懒算：**不在收信时判**。incremental() 是纯收信，往里加模型调用会让
  // 全局同步变慢变贵，而且你不看的信也要付钱。改成通知栏打开时判一批。
  //
  // 判哪些：由前端点名（它知道哪些是「此刻会成为候选的最后一封来信」），
  // 量锁在「你有多少个对象」这个数量级上，不是「你收过多少封信」。
  if (req.method === 'POST' && req.url === '/letters/triage') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const ids = (JSON.parse(raw || '{}').ids || []).filter((x) => typeof x === 'string')
        if (!ids.length) return send(res, 200, { judged: 0, failed: 0 })

        const { data: rows } = await db
          .from('pursuit_messages')
          .select('gmail_message_id, content, body_raw, created_at, counterpart_email')
          .in('gmail_message_id', ids)
          .is('deleted_at', null)
        const { data: heads } = await db
          .from('mail_headers')
          .select('gmail_message_id, from_name, from_email, subject')
          .in('gmail_message_id', ids)
        const headOf = Object.fromEntries((heads || []).map((h) => [h.gmail_message_id, h]))

        const letters = (rows || []).map((r) => ({
          id: r.gmail_message_id,
          from: headOf[r.gmail_message_id]?.from_name
             || headOf[r.gmail_message_id]?.from_email || r.counterpart_email || '对方',
          subject: headOf[r.gmail_message_id]?.subject || '',
          body: r.body_raw || r.content || '',
          at: r.created_at?.slice(0, 10) || '',
        }))
        if (!letters.length) return send(res, 200, { judged: 0, failed: 0 })

        console.log(`\n→ ${new Date().toLocaleTimeString('zh-CN')} 判 ${letters.length} 封信要不要回`)
        const { text } = await think(triagePrompt(letters), READ_TOOLS, null)
        const verdicts = parseTriage(text)

        // 判不出来的**不写库**，下次打开重判。
        // 宁可多吵你一条，绝不许因为一次调用失败就把一封真信悄悄咽掉。
        let judged = 0
        for (const v of verdicts) {
          const { data } = await db.rpc('pa_judge_letter', {
            p_gmail_message_id: v.id, p_needs_reply: v.needs_reply,
            p_not_before: v.not_before, p_why: v.why,
          })
          if (data) judged++
        }
        const out = { judged, failed: letters.length - judged }
        console.log(`  ↳ ${JSON.stringify(out)}`)
        send(res, 200, out)
      } catch (err) {
        console.error('✗', err.message)
        send(res, 500, { error: err.message })
      }
    })
    return
  }

```

- [ ] **Step 6: 真跑一次**

```bash
npm run brain      # 另开一个终端
# 挑两个真的 gmail_message_id（一封有问题的、一封「谢谢回头见」那种）
curl -s localhost:8787/letters/triage -H 'content-type: application/json' \
  -d '{"ids":["<id1>","<id2>"]}' | jq
```

预期：`{"judged":2,"failed":0}`，然后查库：

```sql
select gmail_message_id, needs_reply, not_before, why from public.v_pa_letter_verdicts;
```

**两条判定的 `why` 都得是人话，而且判得对。** 判错就调 `triagePrompt` 里的措辞，
不要动 `parseTriage`。

- [ ] **Step 7: 提交**

```bash
git add brain/triage.js brain/triage.test.js brain/server.js
git commit -m "第三层漏斗：一次判一批信要不要回、是不是现在"
```

---

### Task 5: 补齐由头 —— 机会线的三条 + 判定接上

**Files:**
- Modify: `src/lib/cues.js`
- Modify: `src/lib/cues.test.js`

**Interfaces:**
- Consumes: Task 2 的 `cuesFor`
- Produces: `cuesFor` 多认三样字段——`needs_reply`（缺省当 `true`）、
  `not_before`、`deadline_at`；多出一种 `via: 'deadline'`

- [ ] **Step 1: 加测试（会失败）**

追加到 `src/lib/cues.test.js` 末尾：

```js
// ── 判为不用回的，不进由头 ──────────────────────────────────
test('判了不用回 —— replied 不出现', () => {
  const cs = cuesFor(facts({ last_in_at: T('2026-08-06').toISOString(), needs_reply: false }),
                     { today: T('2026-08-09') })
  assert.equal(via(cs, 'replied'), undefined)
})

test('还没判过 —— 当作要回。漏一封真信比多吵一条坏得多', () => {
  const cs = cuesFor(facts({ last_in_at: T('2026-08-06').toISOString() }),
                     { today: T('2026-08-09') })
  assert.ok(via(cs, 'replied'))
})

// ── 要回，但不是现在 ────────────────────────────────────────
test('他说了下学期再聊 —— 那天之前不出现', () => {
  const f = facts({ last_in_at: T('2026-08-06').toISOString(),
                    needs_reply: true, not_before: '2027-01-15' })
  assert.equal(via(cuesFor(f, { today: T('2026-08-09') }), 'replied'), undefined)
})

test('到了那天 —— 出现，而且说得出出处', () => {
  const f = facts({ last_in_at: T('2026-08-06').toISOString(),
                    needs_reply: true, not_before: '2027-01-15' })
  const c = via(cuesFor(f, { today: T('2027-01-15') }), 'replied')
  assert.ok(c)
  assert.ok(c.why.includes('1/15'))
})

// ── 说好的日子：中途聊过就不响 ──────────────────────────────
test('到日子了，但那之后他来过信 —— 不响', () => {
  const c = via(cuesFor(facts({ next_touch_at: '2026-08-01',
                                last_in_at: T('2026-08-05').toISOString() }),
                        { today: T('2026-08-09') }), 'circleback')
  assert.equal(c, undefined)
})

test('到日子了，那之后没来信 —— 响', () => {
  const c = via(cuesFor(facts({ next_touch_at: '2026-08-01',
                                last_in_at: T('2026-07-20').toISOString(),
                                needs_reply: false }),
                        { today: T('2026-08-09') }), 'circleback')
  assert.ok(c)
})

// ── 截止 ────────────────────────────────────────────────────
test('14 天内截止 —— 提，带天数', () => {
  const c = via(cuesFor(facts({ subject_kind: 'pursuit', deadline_at: '2026-08-20' }),
                        { today: T('2026-08-09') }), 'deadline')
  assert.ok(c.why.includes('8/20'))
  assert.ok(c.why.includes('11 天'))
})

test('已经过了截止 —— 还提，改口', () => {
  const c = via(cuesFor(facts({ subject_kind: 'pursuit', deadline_at: '2026-08-01' }),
                        { today: T('2026-08-09') }), 'deadline')
  assert.ok(c.why.includes('过了'))
})

test('截止还早 —— 不提', () => {
  const c = via(cuesFor(facts({ subject_kind: 'pursuit', deadline_at: '2026-12-01' }),
                        { today: T('2026-08-09') }), 'deadline')
  assert.equal(c, undefined)
})
```

- [ ] **Step 2: 跑，确认新的那几条红**

```bash
npm test 2>&1 | tail -30
```

- [ ] **Step 3: 改 `src/lib/cues.js`**

① `repliedCue` 头上加两道闸，函数体开头（`if (!f.last_in_at) return null` 之后）插入：

```js
  // 判为不用回的：第三层漏斗挡下的（「谢谢，回头见」那种）。
  // **没判过（undefined）当作要回** —— 漏一封真信比多吵一条坏得多。
  if (f.needs_reply === false) return null
  // 要回，但不是现在：日子是从他信里读出来的事实，不是系统编的。
  if (f.not_before && f.not_before > dayOf(today)) return null
```

② `repliedCue` 的 `why`：`not_before` 到期的那种要说得出出处。把 return 换成：

```js
  const d = daysSince(f.last_in_at, today)
  const 到点 = f.not_before
    ? `${md(f.last_in_at)} 他回你了，说好 ${md(f.not_before)} 再聊，到了`
    : null
  return {
    via: 'replied', at: dayOf(f.last_in_at),
    why: 到点 || (d <= 0 ? `${md(f.last_in_at)} 他回你了，还没回`
                         : `${md(f.last_in_at)} 他回你了，${d} 天没回`),
  }
```

③ `circlebackCue` 加上那个前提。在 `if (f.next_touch_at > dayOf(today)) return null` 之后插入：

```js
  // **到那个日子对方没回你，才需要 follow up。**
  // 中间你俩已经聊上了，这条就不该响 —— 这正是断掉的 handleRefresh
  // 想用「模型事后作废」去解决的那件事。现算不需要作废。
  if (f.last_in_at && dayOf(f.last_in_at) >= f.next_touch_at) return null
```

④ 新增 `deadlineCue`，放在 `metCue` 之后：

```js
// 截止。8/12 那份稿子把「紧急」筛选开关留着当容器，说「往里放什么，
// 等卡面这一刀落地之后再定」——放这条。判据沿用它那个：14 天内或已过。
export const DEADLINE_DAYS = 14

function deadlineCue(f, today) {
  if (!f.deadline_at) return null
  const d = daysSince(dayOf(today), f.deadline_at)
  if (d > DEADLINE_DAYS) return null
  return {
    via: 'deadline', at: f.deadline_at,
    why: d < 0 ? `${md(f.deadline_at)} 截止，已经过了 ${-d} 天`
       : d === 0 ? `${md(f.deadline_at)} 截止，就是今天`
       : `${md(f.deadline_at)} 截止，还有 ${d} 天`,
  }
}
```

⑤ `cuesFor` 的数组末尾加 `deadlineCue(f, today)`。

- [ ] **Step 4: 跑，确认全绿**

```bash
npm test
```

- [ ] **Step 5: 提交**

```bash
git add src/lib/cues.js src/lib/cues.test.js
git commit -m "由头补齐：判定接上、说好的日子加前提、截止进来"
```

---

### Task 6: 读面 —— 拉事实、拼三层

**Files:**
- Create: `src/lib/notifications.js`
- Create: `src/lib/notifications.test.js`

**Interfaces:**
- Consumes: `v_pa_cue_facts` / `v_pa_letter_verdicts` / `v_pa_cue_marks` /
  `pa_mark_cue` / `pa_unmark_all_off` / `POST /letters/triage`
- Produces:
  - `FRESH_DAYS = 7`
  - `layer(items, today) -> { hand, old, muted }` —— 纯函数，把条目分三层
  - `loadNotifications() -> { hand, old, muted, unjudged, source, reason }`
  - `markCue(item, mark) -> Promise<boolean>`（`mark` 传 `'done'|'off'|null`）
  - `unmarkAllOff() -> Promise<number>`
  - `triage(ids) -> Promise<{judged, failed}>`
  - 条目形状 `Item = { key, subject_kind, subject_id, name, line_title, cue, verdict }`

- [ ] **Step 1: 写会失败的测试**

```js
// src/lib/notifications.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layer, FRESH_DAYS } from './notifications.js'

const T = (s) => new Date(s + 'T12:00:00Z')
const item = (at, o = {}) => ({
  key: `k${at}`, subject_kind: 'contact', subject_id: 'c1', name: 'Maisa',
  line_title: null, cue: { via: 'replied', at, why: `${at} 他回你了` }, ...o,
})

test('7 天内的进手头，7 天以前的进老账', () => {
  const { hand, old } = layer(
    [item('2026-08-16'), item('2026-08-12'), item('2026-06-01')], T('2026-08-18'))
  assert.equal(hand.length, 2)          // 8/16 和 8/12（差 2 天、6 天）
  assert.equal(old.length, 1)
  assert.equal(old[0].cue.at, '2026-06-01')
})

test('分界线就是 BUMP_WAIT[0] 那个 7', () => {
  assert.equal(FRESH_DAYS, 7)
  const { hand, old } = layer([item('2026-08-11')], T('2026-08-18'))  // 差 7 天
  assert.equal(hand.length, 1)          // 满 7 天还算手头，第 8 天才落账
  assert.equal(old.length, 0)
})

test('停了的（碰满三次）沉到老账 —— 不吵你，但不许消失', () => {
  const { hand, old } = layer(
    [item('2026-08-17', { cue: { via: 'bump', at: '2026-08-17', why: '停了', stopped: true } })],
    T('2026-08-18'))
  assert.equal(hand.length, 0)
  assert.equal(old.length, 1)
})

test('手头按事实日期倒序 —— 新的在上面', () => {
  const { hand } = layer([item('2026-08-12'), item('2026-08-17')], T('2026-08-18'))
  assert.equal(hand[0].cue.at, '2026-08-17')
})

test('被判为不用回的单独一层，一条都不许丢', () => {
  const { hand, old, muted } = layer([
    item('2026-08-17'),
    item('2026-08-16', { key: 'm1', cue: null,
      verdict: { needs_reply: false, why: '「谢谢，回头见」' } }),
  ], T('2026-08-18'))
  assert.equal(hand.length, 1)
  assert.equal(old.length, 0)
  assert.equal(muted.length, 1)
  assert.equal(muted[0].verdict.why, '「谢谢，回头见」')
})
```

- [ ] **Step 2: 跑，确认失败**

```bash
npm test 2>&1 | grep -A3 notifications
```

- [ ] **Step 3: 写 `src/lib/notifications.js`**

```js
import { supa, DB_CONFIGURED, FELL_BACK, BRAIN } from './backends.js'
import { cuesFor, cueKey, BUMP_WAIT } from './cues.js'
import { day as dayOf } from './when.js'

// 顶栏那个 🔔 的读面。
//
// 设计稿：docs/specs/2026-08-18-notifications-design.md
//
// **条目一条都不存，全部现算。** 你在邮箱里回了一封信，下一次拉事实的时候
// 那条通知自己就没了——「自动勾掉」不是一个功能，它是现算这件事本身。
//
// 存的只有三样，每一样都关于一个**不会变的事实**：
//   letter_verdicts —— 那一封信要不要回（信的内容永远不变）
//   cue_marks       —— 你按的 ✓ 和 ✕（锚在事实的日期上）
// 第三样是 pursuit_seen，那是红点的事，不归这儿管。

/** 分界线用 BUMP_WAIT[0] —— 项目里已有的节奏常数，不另发明一个数。 */
export const FRESH_DAYS = BUMP_WAIT[0]

const DAY = 86400000
const daysBetween = (a, b) =>
  Math.round((new Date(dayOf(b) + 'T00:00:00') - new Date(dayOf(a) + 'T00:00:00')) / DAY)

/**
 * 分三层。**三层都数得出来、都点得开**——静默藏起来是这个项目
 * 最不能忍的那种谎。
 *
 * - hand  手头：7 天内的事实
 * - old   老账：7 天以前的，加上「碰满三次停了」那种
 * - muted 被判为不用回的（cue 是 null、只有 verdict 的那些）
 */
export function layer(items, today = new Date()) {
  const hand = [], old = [], muted = []
  for (const it of items) {
    if (!it.cue) { muted.push(it); continue }
    if (it.cue.stopped || daysBetween(it.cue.at, today) > FRESH_DAYS) old.push(it)
    else hand.push(it)
  }
  const 新的在上面 = (a, b) => String(b.cue?.at || '').localeCompare(a.cue?.at || '')
  return { hand: hand.sort(新的在上面), old: old.sort(新的在上面), muted }
}

const empty = (reason, detail) => ({
  hand: [], old: [], muted: [], unjudged: [], source: 'empty', reason, detail,
})

/**
 * 拉一遍。事实、判定、记号三张表各一次，前端拼。
 *
 * 「今天」算一次给所有行用 —— 免得渲染到一半跨过午夜，
 * 前后两半用两个「今天」。
 */
export async function loadNotifications() {
  if (!DB_CONFIGURED) return empty(FELL_BACK.NO_CONFIG)
  try {
    const { data: facts, error: fe } = await supa.from('v_pa_cue_facts').select('*')
    if (fe) return empty(FELL_BACK.QUERY_FAILED, fe.message)

    const ids = [...new Set((facts || []).map((f) => f.last_in_id).filter(Boolean))]
    const [{ data: verdicts }, { data: marks }] = await Promise.all([
      ids.length ? supa.from('v_pa_letter_verdicts').select('*').in('gmail_message_id', ids)
                 : Promise.resolve({ data: [] }),
      supa.from('v_pa_cue_marks').select('*'),
    ])
    const vOf = Object.fromEntries((verdicts || []).map((v) => [v.gmail_message_id, v]))
    const marked = new Set((marks || []).map(
      (m) => `${m.subject_kind}|${m.subject_id}|${m.via}|${m.fact_at}`))

    const today = new Date()
    const items = []
    for (const f of facts || []) {
      const v = f.last_in_id ? vOf[f.last_in_id] : null
      // 判定并进事实行：cues.js 只认 needs_reply / not_before 两个字段，
      // 它不知道判定是从哪张表来的。**没判过就是 undefined = 当作要回。**
      const merged = v ? { ...f, needs_reply: v.needs_reply, not_before: v.not_before } : f
      const cues = cuesFor(merged, { today })

      for (const cue of cues) {
        const key = cueKey(f, cue)
        if (marked.has(key)) continue          // ✓ 或 ✕ 过的，不再出现
        items.push({
          key, subject_kind: f.subject_kind, subject_id: f.subject_id,
          name: f.name, line_title: f.line_title, cue, verdict: v || null,
        })
      }

      // 被判为不用回的：**不消失**，单独一层，看得见理由。
      if (v && v.needs_reply === false && f.last_in_at) {
        items.push({
          key: `${f.subject_kind}|${f.subject_id}|muted|${dayOf(f.last_in_at)}`,
          subject_kind: f.subject_kind, subject_id: f.subject_id,
          name: f.name, line_title: f.line_title, cue: null, verdict: v,
        })
      }
    }

    // 还没判过的最后一封来信 —— 交给 triage() 判一批。
    // **只判此刻会成为候选的那些**，量锁在「你有多少个对象」上。
    const unjudged = (facts || [])
      .filter((f) => f.last_in_id && !vOf[f.last_in_id])
      .map((f) => f.last_in_id)

    return { ...layer(items, today), unjudged: [...new Set(unjudged)],
             source: 'live', reason: null }
  } catch (e) {
    return empty(FELL_BACK.QUERY_FAILED, e.message)
  }
}

/** 打一个记号。mark 传 'done' | 'off' | null（null = 撤销）。 */
export async function markCue(item, mark) {
  const { data, error } = await supa.rpc('pa_mark_cue', {
    p_kind: item.subject_kind, p_id: item.subject_id,
    p_via: item.cue.via, p_at: item.cue.at, p_mark: mark,
  })
  if (error) throw new Error(error.message)
  return Boolean(data)
}

/** 都放回来 —— **只放回 ✕ 的**，真办完的不翻出来。 */
export async function unmarkAllOff() {
  const { data, error } = await supa.rpc('pa_unmark_all_off')
  if (error) throw new Error(error.message)
  return data || 0
}

/** 判一批信要不要回。判不成不抛——最坏是这一批当作「要回」，多吵你几条。 */
export async function triage(ids) {
  if (!ids?.length) return { judged: 0, failed: 0 }
  const r = await fetch(`${BRAIN}/letters/triage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  const out = await r.json().catch(() => null)
  if (!r.ok || !out || out.error) return { judged: 0, failed: ids.length }
  return out
}
```

- [ ] **Step 4: 跑，确认全绿**

```bash
npm test
```

- [ ] **Step 5: 提交**

```bash
git add src/lib/notifications.js src/lib/notifications.test.js
git commit -m "通知的读面：拉事实、并判定、滤记号、拼成三层"
```

---

### Task 7: 顶栏的 🔔 和那块面板

**Files:**
- Create: `src/components/Notifications.jsx`
- Modify: `src/components/Subbar.jsx`
- Modify: `src/App.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 6 的 `loadNotifications` / `markCue` / `unmarkAllOff` / `triage`
- Produces: `<Notifications data onMark onAllBack onOpen onClose />`；
  `Subbar` 多两个 prop：`bellCount`、`onOpenBell`

- [ ] **Step 1: 写 `src/components/Notifications.jsx`**

```jsx
import { useEffect, useState } from 'react'

// 顶栏那块通知面板。**一条一条需要你动的事**，机会线和人混在一起。
//
// 条里只有事实（谁、哪天、说了什么、多少天了）。**建议不在这儿**——
// 想听 Fairwind 怎么说，按 [打开卡片] 进卡里聊，那儿是流式的。
// 把建议先写好存起来的话，它会过期：你后来又收到一封、或者你在别处
// 已经回了，那句建议还挂在那儿说着三天前的情况。那是第一条病换个位置复发。
//
// 设计稿：docs/specs/2026-08-18-notifications-design.md 第三、八、十节

function Row({ it, onMark, onOpen }) {
  const 是机会线 = it.subject_kind === 'pursuit'
  return (
    <div className={'nrow' + (it.cue?.stopped ? ' stopped' : '')}>
      <div className="nrow-b">
        <div className="nrow-h">
          <b>{it.name || (是机会线 ? '（无对接人）' : '未具名联系人')}</b>
          {it.line_title && <span className="nrow-l"> · {it.line_title}</span>}
        </div>
        <div className="nrow-w">{it.cue ? it.cue.why : `判为不用回：${it.verdict?.why}`}</div>
      </div>
      <div className="nrow-a">
        {it.cue && (
          <>
            {/* 办完了。上库，跨设备。有些活办完了不产生任何邮件——
                当面聊过、打了电话、从别的信箱回的，系统无从得知。 */}
            <button className="nbtn" title="办完了" onClick={() => onMark(it, 'done')}>✓</button>
            {/* 先不看。**不改任何事实**——那封信、那个日期原样都在。
                他再回你一封新的，这条会重新出现（键锚在事实的日期上）。 */}
            <button className="nbtn" title="先不看" onClick={() => onMark(it, 'off')}>✕</button>
          </>
        )}
        <button className="nopen" onClick={() => onOpen(it)}>打开卡片</button>
      </div>
    </div>
  )
}

function Fold({ title, items, onMark, onOpen }) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <section className="nsect">
      {/* 收起来了也**永远露着数字**：静默藏起来 = 你以为没有，其实有。 */}
      <button className="nfold" onClick={() => setOpen((x) => !x)}>
        {open ? '▾' : '▸'} {title}（{items.length}）
      </button>
      {open && items.map((it) => (
        <Row key={it.key} it={it} onMark={onMark} onOpen={onOpen} />
      ))}
    </section>
  )
}

export default function Notifications({ data, judging, onMark, onAllBack, onOpen, onClose }) {
  // Esc 收起来
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { hand = [], old = [], muted = [], source, reason } = data || {}

  return (
    <div className="npanel" role="dialog" aria-label="通知">
      <header className="nhead">
        <h2>该动的</h2>
        <button className="nclose" onClick={onClose} aria-label="收起">✕</button>
      </header>

      {/* 空可以，骗人不行 —— 说清是「真没有」还是「没连上」。 */}
      {source === 'empty' && (
        <p className="nnone">没连上数据库（{reason}）。这不是「你没有要办的事」。</p>
      )}

      {judging && <p className="nnone"><i className="spin" aria-hidden="true" /> 正在判新来的信要不要回…</p>}

      <section className="nsect">
        <div className="nsect-h"><h3>手头</h3><span className="ncount">{hand.length} 件</span></div>
        {hand.length ? hand.map((it) => (
          <Row key={it.key} it={it} onMark={onMark} onOpen={onOpen} />
        )) : source !== 'empty' && (
          <p className="nnone">现在没有该动的。这是好事，不是漏了什么。</p>
        )}
      </section>

      <Fold title="老账" items={old} onMark={onMark} onOpen={onOpen} />
      <Fold title="被判为不用回的" items={muted} onMark={onMark} onOpen={onOpen} />

      {/* 永远留一条放回来的路。**只放回 ✕ 的**，真办完的不翻出来。 */}
      <p className="nnone nback">
        按错了？<button className="lnk" onClick={onAllBack}>把「先不看」的都放回来</button>
      </p>
    </div>
  )
}
```

- [ ] **Step 2: 顶栏加 🔔**

`src/components/Subbar.jsx`：props 里加 `bellCount, onOpenBell,`，
在「过卡」那个按钮**之后**插入：

```jsx
          {/* 🔔 的数字 = 「手头」那一层。老账和判掉的不进这个数字——
              它们随时点得开，但不该天天在你眼前报警。
              跟「过卡 · N」并排不合并：队列说「这批还剩几张」，
              通知说「有几件事等你动」，是两件事。 */}
          <button className="bellbtn" onClick={onOpenBell} aria-label="通知">
            🔔{bellCount > 0 && <span className="belln">{bellCount}</span>}
          </button>
```

- [ ] **Step 3: 接进 `src/App.jsx`**

① import：

```js
import Notifications from './components/Notifications.jsx'
import { loadNotifications, markCue, unmarkAllOff, triage } from './lib/notifications.js'
```

② 状态和拉取（放在 queue 那几行边上）：

```js
  // 顶栏那个 🔔。条目一条不存，每次现算（见 lib/notifications.js）。
  const [notes, setNotes] = useState(null)
  const [bellOpen, setBellOpen] = useState(false)
  const [judging, setJudging] = useState(false)

  const pullNotes = async () => {
    const out = await loadNotifications()
    setNotes(out)
    return out
  }
  useEffect(() => { pullNotes() }, [])

  // 打开面板时判一批还没判过的信。**懒算：不看就不花钱。**
  // 判不成不挡路——最坏是这一批当作「要回」，多吵你几条。
  const openBell = async () => {
    setBellOpen(true)
    const out = notes || await pullNotes()
    if (!out?.unjudged?.length) return
    setJudging(true)
    try { await triage(out.unjudged); await pullNotes() } finally { setJudging(false) }
  }

  const onMark = async (it, mark) => {
    try { await markCue(it, mark) } catch (_) {}
    await pullNotes()
  }
  const onAllBack = async () => { await unmarkAllOff(); await pullNotes() }
  const openFromBell = (it) => {
    setBellOpen(false)
    if (it.subject_kind === 'pursuit') openPursuit(it.subject_id)
    else openPerson(it.subject_id)
  }
```

> **接线注意：** `openPursuit` / `openPerson` 用 App 里现成的那两个打开函数。
> 名字对不上就照现有的改——`grep -n "const open" src/App.jsx` 找出来，
> **不要新造一个打开路径**。

③ `<Subbar ... />` 加两个 prop：

```jsx
            bellCount={notes?.hand?.length || 0}
            onOpenBell={openBell}
```

④ 面板挂在 `<QueueRest .../>` 边上：

```jsx
              {bellOpen && (
                <Notifications
                  data={notes} judging={judging}
                  onMark={onMark} onAllBack={onAllBack}
                  onOpen={openFromBell} onClose={() => setBellOpen(false)}
                />
              )}
```

- [ ] **Step 4: 样式**

`src/styles.css` 末尾追加：

```css
/* ── 顶栏通知 ────────────────────────────────────────────── */
.bellbtn { position: relative; background: none; border: 0; cursor: pointer;
           font-size: 15px; padding: 2px 6px; }
.belln   { position: absolute; top: -2px; right: -2px; min-width: 15px;
           padding: 0 3px; border-radius: 8px; background: #d33; color: #fff;
           font: 600 10px/15px system-ui; text-align: center; }

.npanel  { position: absolute; top: 40px; right: 8px; z-index: 40; width: 460px;
           max-height: 72vh; overflow-y: auto; padding: 10px 12px 14px;
           border: 1px solid var(--line, #ddd); border-radius: 8px;
           background: var(--bg, #fff); box-shadow: 0 8px 28px rgba(0,0,0,.16); }
.nhead   { display: flex; align-items: baseline; justify-content: space-between; }
.nhead h2{ font-size: 14px; margin: 0 0 6px; }
.nclose  { background: none; border: 0; cursor: pointer; opacity: .5; }
.nsect   { margin-top: 8px; }
.nsect-h { display: flex; align-items: baseline; gap: 8px; }
.nsect-h h3 { font-size: 12px; margin: 0; opacity: .7; }
.ncount  { font-size: 11px; opacity: .5; }
.nfold   { background: none; border: 0; cursor: pointer; padding: 4px 0;
           font-size: 12px; opacity: .65; }
.nrow    { display: flex; gap: 8px; align-items: flex-start;
           padding: 7px 0; border-top: 1px solid var(--line, #eee); }
.nrow.stopped { opacity: .5; }
.nrow-b  { flex: 1; min-width: 0; }
.nrow-h  { font-size: 12.5px; }
.nrow-l  { opacity: .55; font-weight: 400; }
.nrow-w  { font-size: 12px; opacity: .8; margin-top: 2px; }
.nrow-a  { display: flex; gap: 4px; align-items: center; flex: none; }
.nbtn    { background: none; border: 1px solid var(--line, #ddd); border-radius: 4px;
           cursor: pointer; width: 22px; height: 22px; line-height: 1; font-size: 11px; }
.nopen   { background: none; border: 1px solid var(--line, #ddd); border-radius: 4px;
           cursor: pointer; padding: 3px 7px; font-size: 11px; white-space: nowrap; }
.nnone   { font-size: 12px; opacity: .6; margin: 6px 0; }
.nback   { border-top: 1px solid var(--line, #eee); padding-top: 8px; margin-top: 10px; }
```

- [ ] **Step 5: 眼睛看一遍（真库）**

```bash
npm run brain      # 一个终端
npm run dev        # 另一个
```

对着真库逐条对：

1. 顶栏有 🔔，数字 = 面板里「手头」那一层的条数
2. 第一次点开：转圈说「正在判新来的信要不要回…」，判完条目变少
3. **再点开一次：秒开，不再转圈**（判定缓存住了）
4. 随便一条按 [打开卡片]：机会线开那张机会卡，人开那张名片
5. 按 ✓ → 那条没了；刷新页面 → **还是没了**（上库了）
6. 按 ✕ → 那条没了；按「把『先不看』的都放回来」→ **✕ 的回来了，✓ 的没回来**
7. 「老账」和「被判为不用回的」两栏露着数字，点得开，里面一条不少

- [ ] **Step 6: 提交**

```bash
git add src/components/Notifications.jsx src/components/Subbar.jsx src/App.jsx src/styles.css
git commit -m "顶栏那个 🔔：手头 / 老账 / 判为不用回的，三层都数得出来"
```

---

### Task 8: 旧的关掉记录迁进库，人际管理页那一块删掉

**Files:**
- Modify: `src/App.jsx`（开机迁一次）
- Create: `src/lib/cueoffMigrate.js`
- Delete: `src/lib/cueoff.js`
- Modify: `src/components/People.jsx`
- Modify: `src/components/PersonFocus.jsx`
- Modify: `src/components/Dossier.jsx`

- [ ] **Step 1: 写迁移函数**

```js
// src/lib/cueoffMigrate.js
//
// 旧的 localStorage['pa_cue_off'] 迁进库，迁完清掉。
//
// **已经关掉的那些不许在这次改动里悄悄复活。** 你上周关掉的那条，
// 升级之后又冒出来——那是「你以为处理过了，其实系统忘了」，
// 跟红点撒谎是同一件事。
//
// 旧键：`${contactId}|${via}|${at}`（那时候只有人，没有机会线）
// 新键：`${subject_kind}|${subject_id}|${via}|${at}`
// 所以迁的时候统统当 contact。

import { supa } from './backends.js'

const KEY = 'pa_cue_off'
const DONE = 'pa_cue_off_migrated'

export async function migrateCueOff() {
  try {
    if (localStorage.getItem(DONE)) return 0
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    const keys = Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []
    let n = 0
    for (const k of keys) {
      const [id, via, at] = k.split('|')
      if (!id || !via || !at) continue          // 存坏了的跳过，不拦路
      const { data } = await supa.rpc('pa_mark_cue', {
        p_kind: 'contact', p_id: id, p_via: via, p_at: at, p_mark: 'off',
      })
      if (data) n++
    }
    // 迁完才清。中途失败下次开机重来一遍（RPC 是 upsert，重跑安全）。
    localStorage.setItem(DONE, '1')
    localStorage.removeItem(KEY)
    return n
  } catch (_) {
    return 0                                    // 迁不动最多是几条重新出现，不丢东西
  }
}
```

- [ ] **Step 2: 开机跑一次**

`src/App.jsx` 里，`useEffect(() => { pullNotes() }, [])` 改成：

```js
  useEffect(() => { migrateCueOff().then(pullNotes) }, [])
```

并 import：

```js
import { migrateCueOff } from './lib/cueoffMigrate.js'
```

- [ ] **Step 3: 删掉 `cueoff.js` 和人际管理页那一块**

```bash
git rm src/lib/cueoff.js
```

`src/components/People.jsx`：

- 删掉 `import { cuesFor, cueKey } from '../lib/cues.js'` 和
  `import { loadOff, turnOff, turnAllOn } from '../lib/cueoff.js'`
- 删掉 `const [off, setOff] = useState(loadOff)`
- 删掉 Task 2 Step 5 留下的 `const cues = []` 和 `acting` / `shown` / `hidden` / `live`
  那几个 `useMemo`
- 删掉整个「现在该动的」`<section className="psect">`
- 页头那段 `<p className="note">…这一页只递一件事：现在该动的那几个…</p>` 换成：

```jsx
          <p className="note">
            你会写信的对象都在这儿：人、机构、机构的共享信箱。
            <b>该动哪个</b>不在这一页说了——顶栏那个 🔔 一条一条列着。
          </p>
```

`src/components/PersonFocus.jsx`：删掉 `import { cuesFor } from '../lib/cues.js'`
和 Task 2 Step 5 留下的 `const cues = []`，以及渲染 `cues` 的那几行。

`src/components/Dossier.jsx:163-165`（卡上那句「⏰ 该再碰一次」）：**留着不动**。
它是卡上的事实显示，不是通知。

- [ ] **Step 4: 跑测试 + 眼睛看**

```bash
npm test
npm run dev
```

对着看：

1. 人际管理页**没有**「现在该动的」那一块了；通讯录、按人浏览、名片都照旧
2. 全 app 搜不到 `pa_cue_off` 的读写（`grep -rn "pa_cue_off" src` 只剩
   `cueoffMigrate.js` 那一处）
3. **升级前关掉的那些，升级后依然是关着的**（见下条验收）

- [ ] **Step 5: 验旧记录没复活**

升级**之前**先在浏览器控制台记下来：

```js
JSON.parse(localStorage.getItem('pa_cue_off') || '[]')
```

升级之后查库：

```sql
select subject_id, via, fact_at from public.v_pa_cue_marks where mark = 'off';
```

**上面记下的每一条都得在这张表里。** 一条都不许少。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "关掉的记录迁进库，人际管理页那块由头删掉——通知栏是唯一入口"
```

---

## 自查

对着设计稿逐节点名，每一条都得指得出是哪个任务办的：

| 设计稿 | 哪个任务 |
|---|---|
| 一·① Fairwind 说的 follow-up 没人提醒 | Task 5（`circleback` 加前提）+ Task 7（顶栏出现） |
| 一·② 同一件事两套实现 | Task 2（一份 `cues.js`）+ Task 8（删掉人那边那块） |
| 一·③ 判据只有一条硬规则 | Task 4 + Task 5（判定接上）+ Task 6（分层） |
| 二 条目一条不存 | Task 6（`loadNotifications` 每次现算） |
| 三 一条通知长什么样 | Task 7（`Row`） |
| 四 由头合成一套（六种） | Task 2（五种）+ Task 5（`deadline`、机会线接上） |
| 四 红点不进通知栏 | 全程没碰 `v_pa_pursuits.unread` |
| 四·五 库供事实、JS 拼由头 | Task 1 + Task 2 |
| 五 三层漏斗 | 前两层已有（0045）；第三层 Task 3 + Task 4 |
| 五 判不出来当「要回」 | Task 4 Step 3（`parseTriage` 空数组）+ Task 5（`needs_reply` 缺省当真） |
| 五 判掉的不消失 | Task 6（`muted` 一层）+ Task 7（`Fold` 露数字） |
| 六 要回但不是现在 | Task 4（`not_before`）+ Task 5（那道闸 + 出处） |
| 七 ✓ 打卡上库 | Task 3（`cue_marks`）+ Task 7 |
| 八 分手头 / 老账 | Task 6（`layer`）+ Task 7 |
| 九 ✕ 也上库、旧记录迁进来 | Task 3 + Task 8 |
| 十 建议点开才生成 | Task 7（`Row` 里只有事实，注释写明原委） |
| 十一 🔔 在顶栏、跟过卡并排 | Task 7 Step 2 |
| 十一 人际管理页那块删掉 | Task 8 |
| 十二 不做外部通知 / 不重做 `next_action` / 不动卡面和队列 | 全程没碰 |

### 名字对得上没有

- `cuesFor(f, { today })` —— Task 2 定，Task 5 扩，Task 6 用 ✓
- `cueKey(f, cue)` —— Task 2 定，Task 6 用；跟 `pa_mark_cue` 的
  `(p_kind, p_id, p_via, p_at)` 四段一一对应 ✓
- `v_pa_cue_facts` 的列名 —— Task 1 定，Task 2 的测试假数据、Task 6 的读面
  用的是同一套（`last_in_at` / `last_in_id` / `unanswered_n` / …）✓
- `layer()` 回 `{ hand, old, muted }` —— Task 6 定，Task 7 解构的是同三个名字 ✓
- `FRESH_DAYS = BUMP_WAIT[0]` —— Task 6 定，测试断言 `=== 7` ✓

### 还没落地的一件事

Task 7 Step 3 的 `openPursuit` / `openPerson` 是**照着现有 App 里的打开函数写的占位名**。
执行时先 `grep -n "const open" src/App.jsx` 把真名字找出来对上，
**不要新造一个打开路径**——卡该怎么开，App 里已经有一份了。
