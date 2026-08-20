import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layer, FRESH_DAYS } from './notifications.js'

const T = (s) => new Date(s + 'T12:00:00Z')
const item = (at, o = {}) => ({
  key: `k${at}`, subject_kind: 'contact', subject_id: 'c1', name: 'Maisa',
  line_title: null, cue: { via: 'replied', at, why: `${at} 他回你了` }, verdict: null, ...o,
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

test('三层加起来 = 进去多少条 —— 一条都不许在路上蒸发', () => {
  const items = [item('2026-08-17'), item('2026-06-01'),
    item('2026-08-16', { key: 'm1', cue: null, verdict: { needs_reply: false, why: 'x' } }),
    item('2026-08-15', { cue: { via: 'bump', at: '2026-08-15', why: '停了', stopped: true } })]
  const { hand, old, muted } = layer(items, T('2026-08-18'))
  assert.equal(hand.length + old.length + muted.length, items.length)
})

// 面板摆的是 todo（手头和老账不再分两段）。这条守的是「合并的时候没漏人」——
// 合并写错一个字，51 条老账就从面板上悄悄没了，而角标只数 3 条，你不会发现。
test('todo = 手头 + 老账，一条不多一条不少，新的在上面', () => {
  const items = [item('2026-06-01'), item('2026-08-17'),
    item('2026-08-16', { key: 'm1', cue: null, verdict: { needs_reply: false, why: 'x' } }),
    item('2026-08-15', { cue: { via: 'bump', at: '2026-08-15', why: '停了', stopped: true } })]
  const { hand, old, muted, todo } = layer(items, T('2026-08-18'))
  assert.equal(todo.length, hand.length + old.length)
  assert.deepEqual(todo.map((x) => x.cue.at), ['2026-08-17', '2026-08-15', '2026-06-01'])
  // 被判为不用回的不混进来 —— 它是另一件事，另有一层
  assert.equal(muted.length, 1)
  assert.ok(!todo.some((x) => x.key === 'm1'))
})

test('空的也不炸', () => {
  const { hand, old, muted, todo } = layer([], T('2026-08-18'))
  assert.deepEqual([hand, old, muted, todo], [[], [], [], []])
})

// ── state 那一半：分家和分区 ──────────────────────────────────

import { splitStates, goesTo } from './notifications.js'
import { stateLine, whyLine } from './stateText.js'

const row = (over = {}) => ({
  key: 'x', subject_kind: 'pursuit', subject_id: 'p1', state: 'WAITING_REPLY',
  what: '等 Sarah 排 2027 的课', why: null, zone: 'waiting',
  since_at: '2026-08-14T10:00:00Z', due_at: '2026-09-28T10:00:00Z',
  name: 'Paperbark Books 工作坊', ...over,
})

test('线的事进通知栏，人的事进人际管理页 —— 即便是 NEEDS_REPLY', () => {
  assert.equal(goesTo(row()), 'bell')
  assert.equal(goesTo(row({ subject_kind: 'contact', state: 'NEEDS_REPLY' })), 'people')
})

test('Sarah 那条 9/28 之前在等待区，不在该动的', () => {
  const { bell } = splitStates([row()])
  assert.equal(bell.due.length, 0)
  assert.equal(bell.waiting.length, 1)
})

test('该动的紧的在上：due 早的排前面', () => {
  const { bell } = splitStates([
    row({ key: 'a', zone: 'due', due_at: '2026-08-19' }),
    row({ key: 'b', zone: 'due', due_at: '2026-08-17' }),
  ])
  assert.deepEqual(bell.due.map((x) => x.key), ['b', 'a'])
})

test('等待的措辞带着设定的日子；到点换成「已经起草」', () => {
  assert.match(stateLine(row()), /设定 follow up 时间为 9 月 28 日/)
  assert.match(stateLine(row({ zone: 'due' })), /follow up 已经起草/)
})

test('判「要回」的理由要显示出来 —— 原来完全不显示', () => {
  const it = row({ state: 'NEEDS_REPLY', what: '她在等你点头', why: '她明说了等你确认九月对接 Joo' })
  assert.match(whyLine(it), /凭什么：她明说了/)
})

test('OWE_* 的整句直接用库里拼好的 what', () => {
  const it = row({ state: 'OWE_THANKS', what: '见到了你经「Weidi」介绍认识的「Biayna」，跟他说一声谢谢。' })
  assert.equal(stateLine(it), it.what)
})
