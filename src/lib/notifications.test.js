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

// ── state 那一半：分区和排序（线和人不再分家，2026-08-21）──────

import { splitStates } from './notifications.js'
import { stateLine, whyLine } from './stateText.js'

const row = (over = {}) => ({
  key: 'x', subject_kind: 'pursuit', subject_id: 'p1', state: 'WAITING_REPLY',
  what: '等 Sarah 排 2027 的课', why: null, zone: 'waiting',
  since_at: '2026-08-14T10:00:00Z', due_at: '2026-09-28T10:00:00Z',
  name: 'Paperbark Books 工作坊', ...over,
})

// 他撞上的那件事（2026-08-21）：Steven 约了 8/25 通话 —— 全部见面里最近的
// 一场 —— 却不在 🔔 里，因为他没挂在任何机会线上，被分去了人际管理页。
// 分家的判据错在维度上：分的是「挂在什么上面」，可他要问的是「什么时候该干嘛」。
test('人的事跟线的事排在同一摞里 —— 最近的那场见面不许因为「没挂在线上」而消失', () => {
  const { due, waiting } = splitStates([
    row({ key: 'huntington', due_at: '2026-09-03T14:00:00Z' }),
    row({ key: 'steven', subject_kind: 'contact', state: 'MEETING_SET',
          name: 'Steven Lam', due_at: '2026-08-25T14:00:00Z' }),
    row({ key: 'asu', due_at: '2026-09-11T19:00:00Z' }),
  ])
  assert.equal(due.length, 0)
  // 三条都在，而且最近的 Steven 排最前
  assert.deepEqual(waiting.map((x) => x.key), ['steven', 'huntington', 'asu'])
})

test('一件事只出现一次 —— 合并之后没有第二个位置', () => {
  const rows = [row({ key: 'a' }), row({ key: 'b', subject_kind: 'contact' })]
  const { due, waiting } = splitStates(rows)
  assert.equal(due.length + waiting.length, rows.length)
})

test('Sarah 那条 9/28 之前在等待区，不在该动的', () => {
  const { due, waiting } = splitStates([row()])
  assert.equal(due.length, 0)
  assert.equal(waiting.length, 1)
})

test('该动的紧的在上：due 早的排前面', () => {
  const { due } = splitStates([
    row({ key: 'a', zone: 'due', due_at: '2026-08-19' }),
    row({ key: 'b', zone: 'due', due_at: '2026-08-17' }),
  ])
  assert.deepEqual(due.map((x) => x.key), ['b', 'a'])
})

test('等待的措辞带着设定的日子；到点说「等够了、该催了」', () => {
  assert.match(stateLine(row()), /设定 follow up 时间为 9 月 28 日/)
  // 到点的等待 = 该催了。原来写「在等 X」又摆在「该动的」，位置和话
  // 自相矛盾（「等回信应该在等待里面呀」）。
  assert.match(stateLine(row({ zone: 'due' })), /等了 \d+ 天没等到 —— 该催了/)
  assert.match(whyLine(row({ zone: 'due' })), /没等到的是：/)
})

test('判「要回」的理由要显示出来 —— 原来完全不显示', () => {
  const it = row({ state: 'NEEDS_REPLY', what: '她在等你点头', why: '她明说了等你确认九月对接 Joo' })
  assert.match(whyLine(it), /凭什么：她明说了/)
})

test('OWE_* 的整句直接用库里拼好的 what', () => {
  const it = row({ state: 'OWE_THANKS', what: '见到了你经「Weidi」介绍认识的「Biayna」，跟他说一声谢谢。' })
  assert.equal(stateLine(it), it.what)
})
