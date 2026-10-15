import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tintSlots, slotOf, inBatch, SLOTS } from './batchTint.js'

const ws = (task, extra = {}) => ({ id: Math.random(), kind: 'workshop', task_id: task, ...extra })

test('两摊 workshop 一定是两个色 —— 这是这功能的全部意义', () => {
  const rows = [ws('aaa'), ws('aaa'), ws('bbb')]
  const s = tintSlots(rows)
  assert.notEqual(slotOf(rows[0], s), slotOf(rows[2], s))
  assert.equal(slotOf(rows[0], s), slotOf(rows[1], s))   // 同一摊同色
})

// 上色跟类别无关：模特经纪那一叠也是一叠，也得有色。
test('一叠就是一叠，不管里头是什么类别', () => {
  const rows = [ws('aaa'), { kind: '模特经纪', task_id: 'mmm' }, { kind: 'grant', task_id: 'ggg' }]
  const s = tintSlots(rows)
  assert.notEqual(slotOf(rows[1], s), null)
  assert.notEqual(slotOf(rows[2], s), null)
  assert.equal(new Set([slotOf(rows[0], s), slotOf(rows[1], s), slotOf(rows[2], s)]).size, 3)
})

test('不成摊的保持原样 —— 手填的、机构监测抓的那些', () => {
  const rows = [ws('aaa'), { kind: 'grant', task_id: null }, { kind: 'workshop' }]
  const s = tintSlots(rows)
  assert.equal(slotOf(rows[1], s), null)
  assert.equal(slotOf(rows[2], s), null)
})

// 聚合源捞回来的是一堆各不相同的机会，只是碰巧同一次任务捞的。
// 它既不折叠也不上色 —— 而这两件事由同一个判断决定，不许分家。
test('聚合源不算一摊：不上色，也不算进叠', () => {
  const agg = { kind: 'grant', task_id: 'sss', source: 'scout_aggregators' }
  const rows = [ws('aaa'), agg, { ...agg, kind: '驻留' }]
  const s = tintSlots(rows)
  assert.equal(slotOf(rows[1], s), null)
  assert.equal(slotOf(rows[2], s), null)
  assert.equal(inBatch(agg), false)
  assert.equal(inBatch(rows[0]), true)
})

test('发号只看 id，跟顺序无关 —— 刷新不会换色', () => {
  const a = tintSlots([ws('bbb'), ws('aaa')])
  const b = tintSlots([ws('aaa'), ws('bbb')])
  assert.deepEqual([...a].sort(), [...b].sort())
  assert.equal(a.get('aaa'), b.get('aaa'))
})

test('摊数超过色号就绕回来，不会发出不存在的色', () => {
  const rows = Array.from({ length: SLOTS + 2 }, (_, i) => ws('t' + i))
  for (const [, slot] of tintSlots(rows)) assert.ok(slot >= 0 && slot < SLOTS)
})

test('空的不炸', () => {
  assert.equal(tintSlots([]).size, 0)
  assert.equal(slotOf(null, new Map()), null)
})

test('explicit stacks override task and scout grouping, with stable independent colors', () => {
 const a={id:'a',stack_id:'s1',task_id:'old-task',source:'scout_custom'}
 const b={id:'b',stack_id:'s1',task_id:null}
 const c={id:'c',stack_id:'s2',task_id:'old-task'}
 assert.equal(inBatch(a),true);assert.equal(inBatch(b),true)
 const slots=tintSlots([a,b,c]);assert.equal(slotOf(a,slots),slotOf(b,slots));assert.notEqual(slotOf(a,slots),slotOf(c,slots))
})
