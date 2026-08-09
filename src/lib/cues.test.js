import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cuesFor, actionable, unansweredRun, BUMP_WAIT, MEET_HOURS } from './cues.js'

const T = (s) => new Date(s + 'T12:00:00Z')
const mail = (at, role, id = `${at}-${role}`) =>
  ({ created_at: T(at).toISOString(), role, gmail_message_id: id, kind: 'message' })
const chat = (at, role) =>
  ({ created_at: T(at).toISOString(), role, gmail_message_id: null, kind: 'message' })
const note = (at) =>
  ({ created_at: T(at).toISOString(), role: 'note', kind: 'meet', gmail_message_id: null })

const who = { id: 'c1', name: 'Maisa' }
const via = (cs, v) => cs.find((c) => c.via === v)

// ── ① 该 bump 了 ────────────────────────────────────────────────

test('发出去还没到等待期 —— 不吵你', () => {
  const cs = cuesFor(who, [mail('2026-08-05', 'artist')], { today: T('2026-08-08') })
  assert.equal(via(cs, 'bump'), undefined)
})

test('发出去 7 天没回音 —— 第 1 次碰，带日期', () => {
  const cs = cuesFor(who, [mail('2026-08-01', 'artist')], { today: T('2026-08-08') })
  assert.ok(via(cs, 'bump').why.includes('第 1 次碰'))
  assert.ok(via(cs, 'bump').why.includes('8/1'))
})

test('碰过一次，第 2 次要等 21 天 —— 没到不吵，到了才提', () => {
  const msgs = [mail('2026-07-01', 'artist'), mail('2026-07-10', 'artist')]
  assert.equal(via(cuesFor(who, msgs, { today: T('2026-07-20') }), 'bump'), undefined)
  assert.ok(via(cuesFor(who, msgs, { today: T('2026-08-01') }), 'bump').why.includes('第 2 次碰'))
})

test('碰满两次之后停了 —— 不进队列，但卡上说得出停了', () => {
  const msgs = ['2026-05-01', '2026-05-10', '2026-06-01'].map((d) => mail(d, 'artist'))
  const c = via(cuesFor(who, msgs, { today: T('2026-08-08') }), 'bump')
  assert.equal(c.stopped, true)
  assert.ok(c.why.includes('停了'))
  assert.equal(actionable([c]).length, 0)      // 停了的不塞进手头这摊活
})

test('对方回了 —— bump 归零，不再提', () => {
  const msgs = [mail('2026-07-01', 'artist'), mail('2026-07-03', 'org')]
  assert.equal(via(cuesFor(who, msgs, { today: T('2026-08-08') }), 'bump'), undefined)
})

test('你跟 Fairwind 的商量不算发信 —— 只有邮件才算往来', () => {
  const msgs = [mail('2026-08-01', 'artist'), chat('2026-08-07', 'artist')]
  const c = via(cuesFor(who, msgs, { today: T('2026-08-08') }), 'bump')
  assert.ok(c.why.includes('8/1'))             // 等待期从那封**邮件**算起，不是从聊天算
})

test('unansweredRun 只数最后连着的那几封', () => {
  const msgs = [mail('2026-06-01', 'artist'), mail('2026-06-02', 'org'),
                mail('2026-07-01', 'artist'), mail('2026-07-10', 'artist')]
  assert.equal(unansweredRun(msgs).length, 2)
})

// ── ② 到日子了 ──────────────────────────────────────────────────

test('到日子了 —— 卡上带原话', () => {
  const c = { ...who, next_touch_at: '2026-08-01', next_touch_why: '他说 "circle back next semester"' }
  const cue = via(cuesFor(c, [], { today: T('2026-08-08') }), 'circleback')
  assert.ok(cue.why.includes('circle back next semester'))
  assert.ok(cue.why.includes('8/1'))
})

test('日子还没到 —— 不吵', () => {
  const c = { ...who, next_touch_at: '2026-09-01' }
  assert.equal(via(cuesFor(c, [], { today: T('2026-08-08') }), 'circleback'), undefined)
})

test('没原话也说得出这日子是你自己定的 —— 不许出现来路不明的日期', () => {
  const c = { ...who, next_touch_at: '2026-08-01' }
  assert.ok(via(cuesFor(c, [], { today: T('2026-08-08') }), 'circleback').why.includes('你定的'))
})

// ── ③ 介绍人还没回谢 ────────────────────────────────────────────

test('要等对方真回过你才提回谢 —— 只发出去没人回，谈不上聊上了', () => {
  const c = { ...who, intro_by: 'tom' }
  const only = cuesFor(c, [mail('2026-08-01', 'artist')],
                       { today: T('2026-08-08'), introName: 'Tom Leeser' })
  assert.equal(via(only, 'thanks'), undefined)
  const both = cuesFor(c, [mail('2026-08-01', 'artist'), mail('2026-08-02', 'org')],
                       { today: T('2026-08-08'), introName: 'Tom Leeser' })
  assert.ok(via(both, 'thanks').why.includes('Tom Leeser'))
  assert.ok(via(both, 'thanks').why.includes('Maisa'))
})

test('已经回谢过 —— 不再提', () => {
  const c = { ...who, intro_by: 'tom', intro_thanked_at: '2026-08-05' }
  const cs = cuesFor(c, [mail('2026-08-01', 'artist'), mail('2026-08-02', 'org')],
                     { today: T('2026-08-08'), introName: 'Tom Leeser' })
  assert.equal(via(cs, 'thanks'), undefined)
})

test('没有介绍人 —— 根本不提', () => {
  const cs = cuesFor(who, [mail('2026-08-02', 'org')], { today: T('2026-08-08') })
  assert.equal(via(cs, 'thanks'), undefined)
})

// ── ④ 见面 48 小时信 ────────────────────────────────────────────

test('见了面还没发信 —— 超过 48 小时也不消失，只是改口', () => {
  const early = cuesFor(who, [note('2026-08-08')],
                        { today: new Date(T('2026-08-08').getTime() + 3600e3) })
  assert.ok(via(early, 'met').why.includes('48 小时信还没发'))
  const late = cuesFor(who, [note('2026-08-01')], { today: T('2026-08-08') })
  assert.ok(via(late, 'met').why.includes(`已经过 ${MEET_HOURS} 小时`))
})

test('见完之后已经发过信 —— 不再提', () => {
  const cs = cuesFor(who, [note('2026-08-01'), mail('2026-08-02', 'artist')],
                     { today: T('2026-08-08') })
  assert.equal(via(cs, 'met'), undefined)
})

test('见面之前发的信不算 —— 那封是见面之前的事', () => {
  const cs = cuesFor(who, [mail('2026-07-20', 'artist'), note('2026-08-01')],
                     { today: T('2026-08-08') })
  assert.ok(via(cs, 'met'))
})

// ── 合起来 ──────────────────────────────────────────────────────

test('一个人身上可以同时有好几个由头', () => {
  const c = { ...who, intro_by: 'tom', next_touch_at: '2026-08-01' }
  const cs = cuesFor(c, [mail('2026-07-01', 'artist'), mail('2026-07-02', 'org')],
                     { today: T('2026-08-08'), introName: 'Tom Leeser' })
  assert.deepEqual(cs.map((x) => x.via).sort(), ['circleback', 'thanks'])
})

test('什么由头都没有 —— 空数组，不是 null', () => {
  assert.deepEqual(cuesFor(who, [], { today: T('2026-08-08') }), [])
})

test('等待期就是设计稿里那两个数', () => {
  assert.deepEqual(BUMP_WAIT, [7, 21])
  assert.equal(MEET_HOURS, 48)
})
