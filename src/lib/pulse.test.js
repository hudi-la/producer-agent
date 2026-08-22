import test from 'node:test'
import assert from 'node:assert/strict'
import { makePulse, ERR_EVERY } from './pulse.js'

// 脉搏的规矩（设计稿 2026-08-21-egress-diet.md）：
//   变了才叫、第一次成功只对表不叫、失败降频但不沉默、缓过来无条件叫一遍、
//   看不见就一个字节都不花。

const rig = (seq) => {
  let i = 0
  const read = async () => {
    const v = seq[Math.min(i++, seq.length - 1)]
    if (v instanceof Error) throw v
    return v
  }
  return read
}

test('第一次读到只对表，不叫人', async () => {
  const p = makePulse(rig([7]))
  let called = 0
  p.onPulse(() => called++)
  await p.tick()
  assert.equal(called, 0)
})

test('数变了才叫，没变不叫', async () => {
  const p = makePulse(rig([7, 7, 8]))
  let called = 0
  p.onPulse(() => called++)
  await p.tick()   // 7 —— 对表
  await p.tick()   // 7 —— 没动静
  assert.equal(called, 0)
  await p.tick()   // 8 —— 动了
  assert.equal(called, 1)
})

test('标签页看不见时连读都不读', async () => {
  let reads = 0
  const p = makePulse(async () => { reads++; return 1 }, { visible: () => false })
  p.onPulse(() => {})
  await p.tick()
  assert.equal(reads, 0)
})

test('没人订阅就不读——省下白问的那一跳', async () => {
  let reads = 0
  const p = makePulse(async () => { reads++; return 1 })
  await p.tick()
  assert.equal(reads, 0)
})

test('失败不沉默：每 ERR_EVERY 跳叫一次，让报错的路子照常走', async () => {
  const p = makePulse(async () => { throw new Error('限额打爆') })
  let called = 0
  p.onPulse(() => called++)
  for (let i = 0; i < ERR_EVERY * 2; i++) await p.tick()
  assert.equal(called, 2)
})

test('缓过来无条件叫一遍——哪怕库里其实没动，也得把横幅撤下来', async () => {
  const seq = [5, new Error('断了'), 5]
  const p = makePulse(rig(seq))
  let called = 0
  p.onPulse(() => called++)
  await p.tick()   // 5 —— 对表
  await p.tick()   // 断 —— 还没到降频的口子，不叫
  assert.equal(called, 0)
  await p.tick()   // 又是 5 —— 数没变，但刚断过，得叫
  assert.equal(called, 1)
})

test('退订之后不再被叫', async () => {
  const p = makePulse(rig([1, 2, 3]))
  let called = 0
  const off = p.onPulse(() => called++)
  await p.tick()
  off()
  // 退订后没有订阅方，tick 直接不读——补一个常驻订阅方好让它继续跳
  p.onPulse(() => {})
  await p.tick()
  await p.tick()
  assert.equal(called, 0)
})

test('订阅方抛错不拖累别人', async () => {
  const p = makePulse(rig([1, 2]))
  let called = 0
  p.onPulse(() => { throw new Error('我崩了') })
  p.onPulse(() => called++)
  await p.tick()
  await p.tick()
  assert.equal(called, 1)
})
