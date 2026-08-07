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

// ── dueNow：过卡队列判据 2 ──
import { dueNow } from './filters.js'

test('该碰日到了 → due；还没到 → 不 due', () => {
  assert.equal(dueNow({ next_touch_at: day(0) }), true)
  assert.equal(dueNow({ next_touch_at: day(-2) }), true)
  assert.equal(dueNow({ next_touch_at: day(3) }), false)
})

test('截止进 14 天窗口且球在我 → due；球在对方 → 不 due（光近不吵你）', () => {
  assert.equal(dueNow({ deadline_at: day(5), ball_eff: 'me' }), true)
  assert.equal(dueNow({ deadline_at: day(5), ball_eff: 'them' }), false)
  assert.equal(dueNow({ deadline_at: day(60), ball_eff: 'me' }), false)
})

test('收尾列不算——那些日期是历史，不是待办', () => {
  assert.equal(dueNow({ stage: 'paused', next_touch_at: day(-5) }), false)
  assert.equal(dueNow({ stage: 'won', deadline_at: day(3), ball_eff: 'me' }), false)
})

test('什么日子都没有 → 不 due', () => {
  assert.equal(dueNow({}), false)
})

// ── dueReason：进队得说得出理由 ──
import { dueReason } from './filters.js'

test('该碰日到了，说得出是哪个日子定的', () => {
  assert.match(dueReason({ next_touch_at: day(0) }), /该碰一下 · .*定的就是今天/)
  assert.match(dueReason({ next_touch_at: day(-3) }), /该碰一下 · .*过了 3 天/)
})

test('截止那句自己组，绝不把截止原文（可能是一整段）拖进理由行', () => {
  assert.equal(dueReason({ deadline_at: day(3), ball_eff: 'me' }), '截止还剩 3 天 · 球在你')
  assert.equal(dueReason({ deadline_at: day(0), ball_eff: 'me' }), '今天截止 · 球在你')
  assert.equal(dueReason({ deadline_at: day(-2), ball_eff: 'me' }), '截止过了 2 天 · 球在你')
  // Stanford 那条：deadline 原文是一整段，理由行必须不受影响
  const wall = { deadline_at: day(11), ball_eff: 'me',
    deadline: 'We are now accepting proposals for Spring Quarter 2027. Submissions are due by August 18th at 11:59 pm (PT).' }
  assert.equal(dueReason(wall), '截止还剩 11 天 · 球在你')
})

test('不进队的一律返回 null —— 没理由就不该在队里', () => {
  assert.equal(dueReason({ deadline_at: day(3), ball_eff: 'them' }), null)
  assert.equal(dueReason({ stage: 'paused', next_touch_at: day(-5) }), null)
  assert.equal(dueReason({}), null)
})
