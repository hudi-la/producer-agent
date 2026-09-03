import test from 'node:test'
import assert from 'node:assert/strict'
import { makePulse, ERR_EVERY, AREAS } from './pulse.js'

// 计数器的规矩（设计稿 2026-08-21-egress-diet.md）：
//   只叫变了的那一区、第一次成功只对表不叫、失败降频但不沉默、
//   缓过来无条件叫一遍、看不见就一个字节都不花、区名写错立刻抛错。

const row = (board = 0, thread = 0, deliv = 0) => ({ board, thread, deliv })

const rig = (seq) => {
  let i = 0
  return async () => {
    const v = seq[Math.min(i++, seq.length - 1)]
    if (v instanceof Error) throw v
    return v
  }
}

test('第一次读到只对表，不叫人', async () => {
  const p = makePulse(rig([row(7, 7, 7)]))
  let called = 0
  p.onPulse('board', () => called++)
  await p.tick()
  assert.equal(called, 0)
})

test('只叫变了的那一区 —— 判个地址不该惊动看板', async () => {
  // 看板没动、对话动了：只有对话那边该被叫醒
  const p = makePulse(rig([row(5, 1, 0), row(5, 2, 0)]))
  let board = 0, thread = 0
  p.onPulse('board', () => board++)
  p.onPulse('thread', () => thread++)
  await p.tick()   // 对表
  await p.tick()   // thread 5→… 变了
  assert.equal(thread, 1)
  assert.equal(board, 0, '看板那一列没变，不该被叫')
})

test('一次变两区，两边都叫（来了一封信 = 看板 + 对话）', async () => {
  const p = makePulse(rig([row(1, 1, 9), row(2, 2, 9)]))
  let board = 0, thread = 0, deliv = 0
  p.onPulse('board', () => board++)
  p.onPulse('thread', () => thread++)
  p.onPulse('deliv', () => deliv++)
  await p.tick()
  await p.tick()
  assert.deepEqual([board, thread, deliv], [1, 1, 0])
})

test('没变就一个都不叫', async () => {
  const p = makePulse(rig([row(3, 3, 3), row(3, 3, 3)]))
  let called = 0
  p.onPulse('board', () => called++)
  await p.tick()
  await p.tick()
  assert.equal(called, 0)
})

test('区名写错立刻抛错 —— 漏配不许静默', () => {
  const p = makePulse(rig([row()]))
  assert.throws(() => p.onPulse('bord', () => {}), /没有「bord」这一区/)
  assert.throws(() => p.onPulse('people', () => {}), /people/)
})

test('AREAS 就是前端认的那几区', () => {
  assert.deepEqual(AREAS, ['board', 'thread', 'deliv', 'tasks'])
})

test('标签页看不见时连读都不读', async () => {
  let reads = 0
  const p = makePulse(async () => { reads++; return row() }, { visible: () => false })
  p.onPulse('board', () => {})
  await p.tick()
  assert.equal(reads, 0)
})

test('没人订阅就不读 —— 省下白问的那一跳', async () => {
  let reads = 0
  const p = makePulse(async () => { reads++; return row() })
  await p.tick()
  assert.equal(reads, 0)
})

test('失败不沉默：每 ERR_EVERY 跳叫一次，让报错的路子照常走', async () => {
  const p = makePulse(async () => { throw new Error('限额打爆') })
  let called = 0
  p.onPulse('board', () => called++)
  for (let i = 0; i < ERR_EVERY * 2; i++) await p.tick()
  assert.equal(called, 2)
})

test('缓过来无条件全叫一遍 —— 哪怕库里没动，也得把横幅撤下来', async () => {
  const p = makePulse(rig([row(5, 5, 5), new Error('断了'), row(5, 5, 5)]))
  let board = 0, thread = 0
  p.onPulse('board', () => board++)
  p.onPulse('thread', () => thread++)
  await p.tick()   // 对表
  await p.tick()   // 断
  assert.deepEqual([board, thread], [0, 0])
  await p.tick()   // 数没变，但刚断过 → 两区都叫
  assert.deepEqual([board, thread], [1, 1])
})

test('退订之后不再被叫', async () => {
  const p = makePulse(rig([row(1, 0, 0), row(2, 0, 0), row(3, 0, 0)]))
  let called = 0
  const off = p.onPulse('board', () => called++)
  await p.tick()
  off()
  p.onPulse('thread', () => {})   // 留一个订阅方，好让它继续跳
  await p.tick()
  await p.tick()
  assert.equal(called, 0)
})

test('同一区的订阅方互不拖累', async () => {
  const p = makePulse(rig([row(1, 0, 0), row(2, 0, 0)]))
  let called = 0
  p.onPulse('board', () => { throw new Error('我崩了') })
  p.onPulse('board', () => called++)
  await p.tick()
  await p.tick()
  assert.equal(called, 1)
})
