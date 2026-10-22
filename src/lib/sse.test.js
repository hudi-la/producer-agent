import test from 'node:test'
import assert from 'node:assert/strict'
import { frameSplitter, frameData } from './sse.js'

// 切帧。这里唯一真正要紧的性质是「网络包边界 ≠ 帧边界」——
// 一个 delta 帧被劈成两半是常事，劈错了屏幕上就少一截字。

test('一块里有几帧就吐几帧', () => {
  const s = frameSplitter()
  const out = s.push('data: {"t":"delta","text":"甲"}\n\ndata: {"t":"delta","text":"乙"}\n\n')
  assert.equal(out.length, 2)
  assert.deepEqual(out.map(frameData).map((e) => e.text), ['甲', '乙'])
  assert.equal(s.rest(), '')
})

test('半帧留着等下一块 —— 一个字都不许丢', () => {
  const s = frameSplitter()
  assert.deepEqual(s.push('data: {"t":"del'), [])   // 劈在 JSON 中间
  assert.deepEqual(s.push('ta","text":"接上了"}'), [])  // 还没到空行，仍不算一帧
  const out = s.push('\n\n')
  assert.equal(out.length, 1)
  assert.equal(frameData(out[0]).text, '接上了')
})

test('劈在两个换行中间也算数', () => {
  const s = frameSplitter()
  assert.deepEqual(s.push('data: {"t":"delta","text":"半"}\n'), [])
  const out = s.push('\ndata: {"t":"done"}\n\n')
  assert.deepEqual(out.map(frameData).map((e) => e.t), ['delta', 'done'])
})

test('一个字节一个字节地喂，结果还是那几帧', () => {
  const s = frameSplitter()
  const wire = 'data: {"t":"mine","row":{"id":"m1"}}\n\ndata: {"t":"delta","text":"你好"}\n\ndata: {"t":"done","reply":{"id":"m2"}}\n\n'
  const got = []
  for (const ch of wire) got.push(...s.push(ch))
  assert.deepEqual(got.map(frameData).map((e) => e.t), ['mine', 'delta', 'done'])
  assert.equal(s.rest(), '')
})

test('\\r\\n 收尾的也认', () => {
  const s = frameSplitter()
  const out = s.push('data: {"t":"delta","text":"x"}\r\n\r\n')
  assert.equal(out.length, 1)
  assert.equal(frameData(out[0]).text, 'x')
})

// 载荷。解不出来一律 null，让调用方跳过 —— 心跳和空行不是错误，
// 不该把整条流炸掉。

test('注释帧（心跳）不是数据，也不是错', () => {
  assert.equal(frameData(': keep-alive'), null)
  assert.equal(frameData(''), null)
  assert.equal(frameData('event: ping'), null)
})

test('data 后面是坏 JSON 就当没看见，不抛', () => {
  assert.equal(frameData('data: {坏了'), null)
})

test('文本里有换行也解得出来 —— 它是 JSON 字符串，不是裸换行', () => {
  const e = frameData('data: {"t":"delta","text":"第一行\\n第二行"}')
  assert.equal(e.text, '第一行\n第二行')
})
