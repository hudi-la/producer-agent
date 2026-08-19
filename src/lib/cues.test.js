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
  org_ever_replied: false, mail_on_line: false,
  last_meet_at: null, met_followed_up: false,
  ...o,
})
const via = (cs, v) => cs.find((c) => c.via === v)

// ── ⓪ 他回你了，还没回 ──────────────────────────────────────────
// 这条最常发生也最要紧，最初定四种由头时漏了。

test('他回了你 —— 第一条由头就是它，带日期和天数', () => {
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

// ── ① 该碰了 ────────────────────────────────────────────────────

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

// ── ② 说好的日子 ────────────────────────────────────────────────

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

// ── ③ 回谢介绍人 ────────────────────────────────────────────────

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

// ── ④ 见面 48 小时信 ────────────────────────────────────────────

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

// ── ⑤ 一条往来只出一条通知 ──────────────────────────────────────
// 邮件类的由头归线，人类的归人。判据是 mail_on_line。

test('这段往来已经归了某条线 —— 人那行不再报「他回你了 / 该碰了」', () => {
  const f = facts({ mail_on_line: true,
                    last_in_at: T('2026-08-06').toISOString(),
                    unanswered_n: 1, unanswered_at: T('2026-07-20').toISOString() })
  const cs = cuesFor(f, { today: T('2026-08-09') })
  assert.equal(via(cs, 'replied'), undefined)
  assert.equal(via(cs, 'bump'), undefined)
})

test('但人类的由头照旧归人 —— 压的只是邮件那两条', () => {
  // 来信在该碰日**之前** —— 不然 circleback 的前提（那之后没来信）不成立，
  // 那是另一条规矩在起作用，不是这条测试要验的事。
  const f = facts({ mail_on_line: true, next_touch_at: '2026-08-01',
                    intro_by_name: 'Tom', org_ever_replied: true,
                    last_in_at: T('2026-07-20').toISOString(),
                    last_meet_at: T('2026-08-02').toISOString() })
  const cs = cuesFor(f, { today: T('2026-08-09') })
  assert.ok(via(cs, 'circleback'))
  assert.ok(via(cs, 'thanks'))
  assert.ok(via(cs, 'met'))
})

test('机会线那行不受这条规矩影响', () => {
  const f = facts({ subject_kind: 'pursuit', subject_id: 'p1', mail_on_line: true,
                    last_in_at: T('2026-08-06').toISOString() })
  assert.ok(via(cuesFor(f, { today: T('2026-08-09') }), 'replied'))
})

// ── ⑥ 键 ────────────────────────────────────────────────────────

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

// ── ⑦ 判为不用回的，不进由头 ────────────────────────────────────

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

// ── ⑧ 要回，但不是现在 ──────────────────────────────────────────

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

// ── ⑨ 说好的日子：中途聊过就不响 ────────────────────────────────
// 这是这一整刀最开始要解决的那件事：「到那个时间对方没回我，才需要 follow up」。

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

test('压根没来过信 —— 照响', () => {
  const c = via(cuesFor(facts({ next_touch_at: '2026-08-01' }), { today: T('2026-08-09') }),
                'circleback')
  assert.ok(c)
})

// ── ⑩ 截止 ──────────────────────────────────────────────────────

test('14 天内截止 —— 提，带天数', () => {
  const c = via(cuesFor(facts({ subject_kind: 'pursuit', deadline_at: '2026-08-20' }),
                        { today: T('2026-08-09') }), 'deadline')
  assert.ok(c.why.includes('8/20'))
  assert.ok(c.why.includes('11 天'))
})

test('就是今天 —— 说「就是今天」，不说「还有 0 天」', () => {
  const c = via(cuesFor(facts({ subject_kind: 'pursuit', deadline_at: '2026-08-09' }),
                        { today: T('2026-08-09') }), 'deadline')
  assert.ok(c.why.includes('就是今天'))
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
