import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY, normalize, loadQueue, saveQueue,
  enqueue, done, later, goto, indexOf, allSkipped, inQueue,
  key, keyOf, parseKey,
} from './queue.js'

const P = (id) => ({ kind: 'pursuit', id })
const C = (id) => ({ kind: 'contact', id })
const kp = (id) => key('pursuit', id)
const kc = (id) => key('contact', id)

const q3 = () => enqueue(EMPTY, [P('a'), P('b'), P('c')])
const ids = (q) => q.items.map(keyOf)

test('塞三张，光标落在第一张', () => {
  const q = q3()
  assert.deepEqual(ids(q), [kp('a'), kp('b'), kp('c')])
  assert.equal(q.at, kp('a'))
  assert.equal(indexOf(q), 0)
})

test('不重复塞 —— 同一张塞两次还是一张，位置不动，via 更新', () => {
  const q = enqueue(q3(), [{ ...P('a'), via: 'mail' }])
  assert.deepEqual(ids(q), [kp('a'), kp('b'), kp('c')])
  assert.equal(q.items[0].via, 'mail')
})

test('再塞一张放过的，「先放着」清零 —— 它变了，值得你再看一眼', () => {
  const q = enqueue(later(q3(), kp('a')), [{ ...P('a'), via: 'mail' }])
  assert.equal(q.items.find((x) => keyOf(x) === kp('a')).skipped, false)
  assert.equal(q.items.find((x) => keyOf(x) === kp('a')).skippedAt, null)
})

test('做完了：拿走，光标落到原位置上的下一张', () => {
  const q = done(q3(), kp('a'))
  assert.deepEqual(ids(q), [kp('b'), kp('c')])
  assert.equal(q.at, kp('b'))
})

test('做完最后一张，光标退回上一张', () => {
  let q = q3()
  q = goto(q, 2)
  q = done(q, kp('c'))
  assert.deepEqual(ids(q), [kp('a'), kp('b')])
  assert.equal(q.at, kp('b'))
})

test('做完唯一一张 —— 队空了', () => {
  const q = done(enqueue(EMPTY, [P('a')]), kp('a'))
  assert.deepEqual(q, EMPTY)
})

test('再等一等：留着，挪队尾，数字不降', () => {
  const q = later(q3(), kp('a'), '2026-08-06')
  assert.deepEqual(ids(q), [kp('b'), kp('c'), kp('a')])
  assert.equal(q.items.length, 3)
  assert.equal(q.items[2].skipped, true)
  assert.equal(q.items[2].skippedAt, '2026-08-06')
  assert.equal(q.at, kp('b'))
})

test('全放过了 —— 抽屉该停手，不无限转圈', () => {
  let q = q3()
  q = later(q, kp('a')); q = later(q, kp('b')); q = later(q, kp('c'))
  assert.equal(allSkipped(q), true)
  assert.equal(q.items.length, 3)
})

test('空队不算「全放过了」—— 没有"剩下的"', () => {
  assert.equal(allSkipped(EMPTY), false)
})

test('翻页什么都不改，只移动光标；到头就停住', () => {
  const q = q3()
  const a = goto(q, 1)
  assert.equal(a.at, kp('b'))
  assert.deepEqual(a.items, q.items)          // 翻页不动任何一条
  assert.equal(goto(a, -5).at, kp('a'))       // 到头停住，不回绕
  assert.equal(goto(a, 99).at, kp('c'))
})

test('inQueue', () => {
  assert.equal(inQueue(q3(), kp('b')), true)
  assert.equal(inQueue(q3(), kp('zz')), false)
})

test('normalize 挡住存坏了的东西：非法项、重复 id、指不到人的光标', () => {
  const got = normalize({
    items: [P('a'), null, P('a'), { nope: 1 }, { ...P('b'), skipped: 1 }],
    at: 'ghost',
  })
  assert.deepEqual(ids(got), [kp('a'), kp('b')])
  assert.equal(got.items[1].skipped, true)
  assert.equal(got.at, kp('a'))
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
  const q = later(q3(), kp('a'), '2026-08-06')
  saveQueue(q)
  assert.deepEqual(loadQueue(), q)
})

// ── 装得下人 ────────────────────────────────────────────────────

test('旧存档没有 kind —— 一律当 pursuit，一项都不丢', () => {
  const old = { items: [{ id: 'a', via: 'pick' }, { id: 'b', via: 'update' }], at: 'b' }
  const q = normalize(old)
  assert.equal(q.items.length, 2)
  assert.equal(q.items[0].kind, 'pursuit')
  assert.equal(q.at, kp('b'))          // 裸 id 的光标也要认回来
  assert.equal(q.items[1].via, 'update')   // via 不能被清掉
})

test('人和机会线撞同一个 id 也是两项 —— 去重按 kind+id', () => {
  const q = enqueue(EMPTY, [P('x'), C('x')])
  assert.equal(q.items.length, 2)
  assert.deepEqual(ids(q), [kp('x'), kc('x')])
})

test('同一个人塞两次还是一项，via 更新', () => {
  const q = enqueue(enqueue(EMPTY, [C('m')]), [{ ...C('m'), via: 'bump' }])
  assert.equal(q.items.length, 1)
  assert.equal(q.items[0].via, 'bump')
})

test('做完一个人：拿走，光标落到下一张', () => {
  const q = done(enqueue(EMPTY, [C('m'), P('p')]), kc('m'))
  assert.deepEqual(ids(q), [kp('p')])
  assert.equal(q.at, kp('p'))
})

test('机会线和人混在同一队里，翻页翻得过去', () => {
  const q = enqueue(EMPTY, [P('a'), C('m'), P('b')])
  assert.deepEqual(ids(q), [kp('a'), kc('m'), kp('b')])
  assert.equal(goto(q, 1).at, kc('m'))
})

test('key / parseKey 转得回来', () => {
  assert.equal(key('contact', 'abc'), 'contact:abc')
  assert.deepEqual(parseKey('contact:abc'), { kind: 'contact', id: 'abc' })
  assert.deepEqual(parseKey('pursuit:abc'), { kind: 'pursuit', id: 'abc' })
  // 旧存档里的裸 id
  assert.deepEqual(parseKey('abc'), { kind: 'pursuit', id: 'abc' })
  // uuid 里没有冒号，但万一 id 里有，只切第一个
  assert.deepEqual(parseKey('contact:a:b'), { kind: 'contact', id: 'a:b' })
})

test('不认识的 kind 一律当 pursuit —— 存坏了也不许出现第三种东西', () => {
  const q = normalize({ items: [{ kind: 'nonsense', id: 'a' }], at: null })
  assert.equal(q.items[0].kind, 'pursuit')
  assert.equal(q.at, kp('a'))
})

// ── 一批里混着线和人（2026-08-21 他要的「人也能批量操作」）─────────
//
// 勾中的存的是 key 而不是裸 id。这几条锁住的是那个理由：到了群发那步，
// 要靠 key 分清这句话该发给谁——线走 pursuit_id、人走 contact_id。
// 光存 id 的话两种混在一摞里就再也分不开了。

import { ownerBody } from './chat.js'

test('勾中的键拆回来能分清是线还是人', () => {
  const picked = [kp('线1'), kc('人1'), kp('线2')]
  assert.deepEqual(picked.map(parseKey), [
    { kind: 'pursuit', id: '线1' },
    { kind: 'contact', id: '人1' },
    { kind: 'pursuit', id: '线2' },
  ])
})

test('群发时，线发 pursuit_id、人发 contact_id', () => {
  assert.deepEqual(ownerBody(parseKey(kp('线1'))), { pursuit_id: '线1' })
  assert.deepEqual(ownerBody(parseKey(kc('人1'))), { contact_id: '人1' })
})

test('老调用方传裸字符串仍当机会线 —— 不许改坏已有的路', () => {
  assert.deepEqual(ownerBody('线1'), { pursuit_id: '线1' })
})

test('线和人混着进队，各自留在自己的身份里', () => {
  const q = enqueue(EMPTY, [
    { kind: 'pursuit', id: 'a', via: 'pick' },
    { kind: 'contact', id: 'b', via: 'pick' },
  ])
  assert.deepEqual(q.items.map(keyOf), [kp('a'), kc('b')])
  // 同一个 id 的线和人是两件事，不该互相顶掉
  const q2 = enqueue(q, [{ kind: 'contact', id: 'a', via: 'say' }])
  assert.equal(q2.items.length, 3)
})
