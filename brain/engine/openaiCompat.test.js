import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { runAgent } from './openaiCompat.js'

// 造一个"服务器":按第几次请求回不同的流
const sse = (chunks) => ({ ok: true, status: 200, body: new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(x) + '\n\n')); c.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); c.close() } }) })
const delta = (d, extra = {}) => ({ choices: [{ delta: d }], ...extra })

test('纯文字:流式报字,blocks 一段,usage 记 token', async () => {
  const events = []
  const fetchImpl = async () => sse([delta({ content: '你' }), delta({ content: '好' }), { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } }])
  const r = await runAgent({ baseURL: 'http://x/v1', apiKey: 'k', model: 'm', system: 'sys', prompt: 'hi', onEvent: (e) => events.push(e), fetchImpl })
  assert.deepEqual(r.blocks, [{ type: 'text', text: '你好' }])
  assert.deepEqual(events, [{ t: 'delta', text: '你' }, { t: 'delta', text: '好' }])
  assert.equal(r.usage.inp, 10); assert.equal(r.usage.out, 2); assert.equal(r.usage.turns, 1)
})

test('工具循环:第一轮要工具 → 跑 handler → 结果塞回 → 第二轮答话;blocks 按顺序', async () => {
  const reqs = []
  const tool = { name: 'lookup', description: 'd', shape: { q: z.string() }, handler: async ({ q }) => ({ content: [{ type: 'text', text: 'answer for ' + q }] }) }
  const fetchImpl = async (url, init) => {
    reqs.push(JSON.parse(init.body))
    if (reqs.length === 1) return sse([delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'lookup', arguments: '{"q":' } }] }), delta({ tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] })])
    return sse([delta({ content: 'done' })])
  }
  const events = []
  const r = await runAgent({ baseURL: 'http://x/v1', apiKey: 'k', model: 'm', prompt: 'p', tools: [tool], onEvent: (e) => events.push(e), fetchImpl })
  assert.deepEqual(r.blocks.map((b) => b.type), ['tool_use', 'text'])
  assert.deepEqual(r.blocks[0].input, { q: 'x' })
  assert.equal(reqs[0].tools[0].function.name, 'lookup')
  assert.equal(reqs[1].messages.at(-1).role, 'tool'); assert.equal(reqs[1].messages.at(-1).content, 'answer for x')
  assert.equal(reqs[1].messages.at(-2).tool_calls[0].function.arguments, '{"q":"x"}')
  assert.ok(events.some((e) => e.t === 'tool' && e.name === 'lookup'))
  assert.equal(r.usage.turns, 2)
})

test('图片工具结果另起一条 user 消息(image_url data:)', async () => {
  const reqs = []
  const tool = { name: 'pic', description: 'd', shape: {}, handler: async () => ({ content: [{ type: 'text', text: '# a.png' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] }) }
  const fetchImpl = async (url, init) => { reqs.push(JSON.parse(init.body)); return reqs.length === 1 ? sse([delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'pic', arguments: '{}' } }] })]) : sse([delta({ content: 'ok' })]) }
  await runAgent({ baseURL: 'http://x/v1', apiKey: 'k', model: 'm', prompt: 'p', tools: [tool], fetchImpl })
  const last = reqs[1].messages.at(-1)
  assert.equal(last.role, 'user'); assert.equal(last.content[0].image_url.url, 'data:image/png;base64,AAAA')
})

test('接口报错:429/5xx 重试两次后抛;4xx 直接抛,带原文', async () => {
  let n = 0
  const bad = async () => { n++; return { ok: false, status: 500, text: async () => 'boom' } }
  await assert.rejects(() => runAgent({ baseURL: 'http://x/v1', apiKey: 'k', model: 'm', prompt: 'p', fetchImpl: bad, log: () => {} }), /500/)
  assert.equal(n, 3)
  const unauthorized = async () => ({ ok: false, status: 401, text: async () => 'bad key' })
  await assert.rejects(() => runAgent({ baseURL: 'http://x/v1', apiKey: 'k', model: 'm', prompt: 'p', fetchImpl: unauthorized }), /401.*bad key/)
})

test('到 maxTurns 就停,不死循环', async () => {
  const tool = { name: 't', description: 'd', shape: {}, handler: async () => ({ content: [{ type: 'text', text: 'again' }] }) }
  const fetchImpl = async () => sse([delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 't', arguments: '{}' } }] })])
  const r = await runAgent({ baseURL: 'http://x/v1', apiKey: 'k', model: 'm', prompt: 'p', tools: [tool], maxTurns: 3, fetchImpl })
  assert.equal(r.usage.turns, 3); assert.equal(r.blocks.filter((b) => b.type === 'tool_use').length, 3)
})
