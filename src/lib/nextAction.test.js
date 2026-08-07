import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionLine, voidedAction } from './nextAction.js'

test('作废的待办不再出现在「该干什么」那行', () => {
  const p = { next_action: '催 LOA', next_action_void_at: '2026-08-06T10:00:00Z' }
  assert.equal(actionLine(p), null)
})

test('作废但有开放日的卡，往下顺位到开放那条——作废不该让卡哑掉', () => {
  const d = new Date(); d.setDate(d.getDate() + 5); d.setHours(0, 0, 0, 0)
  const pad = (x) => String(x).padStart(2, '0')
  const opens = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const p = { next_action: '催 LOA', next_action_void_at: '2026-08-06T10:00:00Z', opens_at: opens }
  assert.match(actionLine(p).text, /起开放/)
})

test('它提的待办带 by 标记；你写的不带', () => {
  assert.equal(actionLine({ next_action: 'x', next_action_by: 'fairwind' }).by, 'fairwind')
  assert.equal(actionLine({ next_action: 'x', next_action_by: 'you' }).by, null)
  assert.equal(actionLine({ next_action: 'x' }).by, null)   // 旧数据没这列
})

test('voidedAction 把作废行整理出来，含指回那封信的 id', () => {
  const p = { next_action: '催 LOA', next_action_void_at: '2026-08-06T10:00:00Z', next_action_void_by: 'msg-1' }
  const v = voidedAction(p)
  assert.equal(v.text, '催 LOA')
  assert.equal(v.byMsg, 'msg-1')
  assert.match(v.at, /8月6日/)
})

test('没作废就没有作废行', () => {
  assert.equal(voidedAction({ next_action: '催 LOA' }), null)
})
