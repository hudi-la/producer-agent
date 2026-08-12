import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deadlineLine, openLine, daysFromToday, MD } from './nextAction.js'

// 原来这个文件测的是 actionLine / voidedAction —— 那一整套「该干什么」
// 已经删了（见 nextAction.js 顶部）。现在只剩日期，测的也只有日期。

const inDays = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── 截止 ────────────────────────────────────────────────────────

test('没有截止就是没有，不编一个', () => {
  assert.equal(deadlineLine({}), null)
})

test('截止原文永远保留——"spring 2027" 这种算不出日期，但它是真话', () => {
  const l = deadlineLine({ deadline: 'spring 2027' })
  assert.equal(l.text, '截止 spring 2027')
  assert.equal(l.urgent, false)
})

test('远的不标急，近的才标', () => {
  assert.equal(deadlineLine({ deadline_at: inDays(60) }).urgent, false)
  assert.equal(deadlineLine({ deadline_at: inDays(3) }).urgent, true)
})

test('今天到期、已经过期，说法不一样', () => {
  assert.match(deadlineLine({ deadline_at: inDays(0) }).text, /今天/)
  const over = deadlineLine({ deadline_at: inDays(-2) })
  assert.match(over.text, /已过/)
  assert.equal(over.over, true)
})

// ── 开放 ────────────────────────────────────────────────────────
// 开始日期是**确定的信息**，有就显示。它不再包装成「该干什么」——
// 那一整套删了——但日期本身留着。

test('还没开放：说清是在等它开门，带天数', () => {
  const l = openLine({ opens_at: inDays(5) })
  assert.match(l.text, /起开放/)
  assert.match(l.text, /还有 5 天/)
})

test('已经开放了就不说了——那时候「开放」不是新闻', () => {
  assert.equal(openLine({ opens_at: inDays(0) }), null)
  assert.equal(openLine({ opens_at: inDays(-3) }), null)
})

test('没有开放日就是没有', () => {
  assert.equal(openLine({}), null)
})

// ── 日期工具 ────────────────────────────────────────────────────

test('daysFromToday：过去是负数，空值是 null', () => {
  assert.equal(daysFromToday(inDays(7)), 7)
  assert.equal(daysFromToday(inDays(-1)), -1)
  assert.equal(daysFromToday(null), null)
})

test('MD 按本地时区格式化，不留前导零', () => {
  assert.equal(MD('2026-08-06'), '8月6日')
  assert.equal(MD(null), '')
})
