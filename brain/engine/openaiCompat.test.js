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

test('模型下线回 404 并点名接替型号 → 自动换那个再试一次(Gemini 2.5 对新用户的那种)', async () => {
  const models = []
  const fetchImpl = async (url, init) => {
    const b = JSON.parse(init.body); models.push(b.model)
    if (b.model === 'gemini-2.5-pro') return { ok: false, status: 404, text: async () => '[{"error":{"code":404,"message":"This model models/gemini-2.5-pro is no longer available to new users. Please update your code to use models/gemini-3.1-pro-preview for the latest features"}}]' }
    return sse([delta({ content: 'ok' })])
  }
  const r = await runAgent({ baseURL: 'http://x/v1', apiKey: 'k', model: 'gemini-2.5-pro', prompt: 'hi', fetchImpl })
  assert.deepEqual(models, ['gemini-2.5-pro', 'gemini-3.1-pro-preview'])
  assert.deepEqual(r.blocks, [{ type: 'text', text: 'ok' }])
})

test('404 但没点名接替的 → 照旧报错,不瞎换', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => 'not found' })
  await assert.rejects(runAgent({ baseURL: 'http://x/v1', apiKey: 'k', model: 'm', prompt: 'hi', fetchImpl }), /模型接口回 404/)
})

test('429 没额度 → 不傻等,直接换备选链下一个;503 重试两次还挤 → 也换', async () => {
  const models = []
  const fetchImpl = async (url, init) => {
    const b = JSON.parse(init.body); models.push(b.model)
    if (b.model === 'pro') return { ok: false, status: 429, text: async () => '{"error":{"message":"You exceeded your current quota, please check your plan and billing details."}}' }
    if (b.model === 'flash') return { ok: false, status: 503, text: async () => 'high demand' }
    return sse([delta({ content: 'ok' })])
  }
  const r = await runAgent({ baseURL: 'http://x/v1', apiKey: 'k', model: 'pro', fallbacks: ['flash', 'flash-preview'], prompt: 'hi', fetchImpl })
  assert.deepEqual(models, ['pro', 'flash', 'flash', 'flash', 'flash-preview'])
  assert.deepEqual(r.blocks, [{ type: 'text', text: 'ok' }])
})

test('Gemini 3.x 的 thought_signature(extra_content)下一轮原样带回去', async () => {
  const reqs = []
  const fetchImpl = async (url, init) => {
    reqs.push(JSON.parse(init.body))
    if (reqs.length === 1) return sse([delta({ tool_calls: [{ index: 0, id: 'c1', extra_content: { google: { thought_signature: 'SIG' } }, function: { name: 'lookup', arguments: '{"q":"x"}' } }] })])
    return sse([delta({ content: 'done' })])
  }
  await runAgent({ baseURL: 'http://x/v1', apiKey: 'k', model: 'm', prompt: 'hi', fetchImpl, tools: [{ name: 'lookup', description: 'd', input_schema: { type: 'object', properties: {} }, handler: async () => 'r' }] })
  const asst = reqs[1].messages.find((m) => m.role === 'assistant' && m.tool_calls)
  assert.deepEqual(asst.tool_calls[0].extra_content, { google: { thought_signature: 'SIG' } })
})
