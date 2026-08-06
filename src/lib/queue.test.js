import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY, normalize, loadQueue, saveQueue,
  enqueue, done, later, goto, indexOf, allSkipped, inQueue,
} from './queue.js'

const q3 = () => enqueue(EMPTY, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])
const ids = (q) => q.items.map((x) => x.id)

test('塞三张，光标落在第一张', () => {
  const q = q3()
  assert.deepEqual(ids(q), ['a', 'b', 'c'])
  assert.equal(q.at, 'a')
  assert.equal(indexOf(q), 0)
})

test('不重复塞 —— 同一张塞两次还是一张，位置不动，via 更新', () => {
  const q = enqueue(q3(), [{ id: 'a', via: 'mail' }])
  assert.deepEqual(ids(q), ['a', 'b', 'c'])
  assert.equal(q.items[0].via, 'mail')
})

test('再塞一张放过的，「先放着」清零 —— 它变了，值得你再看一眼', () => {
  const q = enqueue(later(q3(), 'a'), [{ id: 'a', via: 'mail' }])
  assert.equal(q.items.find((x) => x.id === 'a').skipped, false)
  assert.equal(q.items.find((x) => x.id === 'a').skippedAt, null)
})

test('做完了：拿走，光标落到原位置上的下一张', () => {
  const q = done(q3(), 'a')
  assert.deepEqual(ids(q), ['b', 'c'])
  assert.equal(q.at, 'b')
})

test('做完最后一张，光标退回上一张', () => {
  let q = q3()
  q = goto(q, 2)
  q = done(q, 'c')
  assert.deepEqual(ids(q), ['a', 'b'])
  assert.equal(q.at, 'b')
})

test('做完唯一一张 —— 队空了', () => {
  const q = done(enqueue(EMPTY, [{ id: 'a' }]), 'a')
  assert.deepEqual(q, EMPTY)
})

test('再等一等：留着，挪队尾，数字不降', () => {
  const q = later(q3(), 'a', '2026-08-06')
  assert.deepEqual(ids(q), ['b', 'c', 'a'])
  assert.equal(q.items.length, 3)
  assert.equal(q.items[2].skipped, true)
  assert.equal(q.items[2].skippedAt, '2026-08-06')
  assert.equal(q.at, 'b')
})

test('全放过了 —— 抽屉该停手，不无限转圈', () => {
  let q = q3()
  q = later(q, 'a'); q = later(q, 'b'); q = later(q, 'c')
  assert.equal(allSkipped(q), true)
  assert.equal(q.items.length, 3)
})

test('空队不算「全放过了」—— 没有"剩下的"', () => {
  assert.equal(allSkipped(EMPTY), false)
})

test('翻页什么都不改，只移动光标；到头就停住', () => {
  const q = q3()
  const a = goto(q, 1)
  assert.equal(a.at, 'b')
  assert.deepEqual(a.items, q.items)          // 翻页不动任何一条
  assert.equal(goto(a, -5).at, 'a')           // 到头停住，不回绕
  assert.equal(goto(a, 99).at, 'c')
})

test('inQueue', () => {
  assert.equal(inQueue(q3(), 'b'), true)
  assert.equal(inQueue(q3(), 'zz'), false)
})

test('normalize 挡住存坏了的东西：非法项、重复 id、指不到人的光标', () => {
  const got = normalize({
    items: [{ id: 'a' }, null, { id: 'a' }, { nope: 1 }, { id: 'b', skipped: 1 }],
    at: 'ghost',
  })
  assert.deepEqual(ids(got), ['a', 'b'])
  assert.equal(got.items[1].skipped, true)
  assert.equal(got.at, 'a')
})

test('normalize 收到垃圾就还一个空队', () => {
  assert.deepEqual(normalize(null), EMPTY)
  assert.deepEqual(normalize({ items: 'nope' }), EMPTY)
})

test('存进去读回来是同一份', () => {
  globalThis.localStorage = {
    _d: {},
    getItem(k) { return k in this._d ? this._d[k] : null },
    setItem(k, v) { this._d[k] = String(v) },
  }
  const q = later(q3(), 'a', '2026-08-06')
  saveQueue(q)
  assert.deepEqual(loadQueue(), q)
})
