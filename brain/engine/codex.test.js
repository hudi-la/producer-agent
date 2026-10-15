import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { CodexClient, codexOptions, runCodex, chatgptStatus, chatgptLogin } from './codex.js'

function fake({ account = { type: 'chatgpt', email: 'student@example.com', planType: 'plus' }, turn } = {}) {
  const c = { listeners: new Set(), requests: [], sent: [], closed: false,
    async init() { return c },
    emit(method, params = {}) { for (const fn of c.listeners) fn({ method, params }) },
    async request(method, params) {
      c.requests.push({ method, params })
      if (method === 'account/read') return { account }
      if (method === 'account/login/start') return { authUrl: 'https://auth.openai.com/test', loginId: 'login' }
      if (method === 'thread/start') return { thread: { id: 'thread' } }
      if (method === 'turn/start') { queueMicrotask(() => turn?.(c)); return { turn: { id: 'turn' } } }
    },
    send(m) { c.sent.push(m) },
    close() { if (!c.closed) { c.closed = true; c.emit('connection/closed', { error: new Error('closed') }) } },
  }
  return c
}
const emit = (c, method, params) => c.emit(method, { threadId: 'thread', ...params })
const complete = (c, status = 'completed') => emit(c, 'turn/completed', { turn: { status } })
const message = (c, text) => emit(c, 'item/completed', { item: { type: 'agentMessage', text } })

test('subscription uses isolated home and never inherits API credentials or Codex settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-codex-env-'))
  try {
    const opts = codexOptions(dir, { HOME: '/home/student', PATH: '/bin', OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret', CODEX_HOME: '/other', ANTHROPIC_API_KEY: 'secret' })
    assert.equal(opts.env.CODEX_HOME, join(dir, 'chatgpt'))
    assert.equal(opts.env.OPENAI_API_KEY, undefined); assert.equal(opts.env.CODEX_API_KEY, undefined)
    assert.equal(opts.env.ANTHROPIC_API_KEY, undefined); assert.equal(opts.env.HOME, '/home/student')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('streams text, invokes only supplied tools, returns text and images, captures usage', async () => {
  let called = 0
  const events = []
  const c = fake({ turn: async (c) => {
    emit(c, 'item/agentMessage/delta', { delta: 'Checking' }); message(c, 'Checking')
    await c.onRequest({ id: 80, method: 'item/tool/call', params: { threadId: 'thread', callId: 'call', tool: 'lookup', arguments: { name: 'art' } } })
    await c.onRequest({ id: 81, method: 'item/tool/call', params: { threadId: 'thread', tool: 'shell', arguments: {} } })
    await c.onRequest({ id: 82, method: 'item/tool/call', params: { threadId: 'other', tool: 'lookup', arguments: {} } })
    message(c, 'Found it')
    emit(c, 'thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 12, cachedInputTokens: 3, outputTokens: 8 } } })
    complete(c)
  } })
  const r = await runCodex({ clientFactory: () => c, prompt: 'find art', system: ['first', { text: 'second' }], onEvent: (e) => events.push(e), tools: [{ name: 'lookup', description: 'Look up', shape: { name: z.string() }, handler: async (input) => { called++; assert.equal(input.name, 'art'); return { content: [{ type: 'text', text: 'ok' }, { type: 'image', mimeType: 'image/png', data: 'abc' }] } } }] })
  assert.equal(called, 1); assert.equal(c.closed, true)
  assert.deepEqual(r.blocks.map((b) => b.type), ['text', 'tool_use', 'text'])
  assert.equal(r.usage.inp, 12); assert.equal(r.usage.cacheRead, 3)
  assert.equal(c.sent[0].result.contentItems[1].imageUrl, 'data:image/png;base64,abc')
  assert.equal(c.sent[1].result.success, false); assert.equal(c.sent[2].result.success, false)
  const opts = c.requests.find((r) => r.method === 'thread/start').params
  assert.deepEqual(opts.environments, []); assert.equal(opts.sandbox, 'read-only'); assert.equal(opts.ephemeral, true)
  assert.equal(opts.baseInstructions, 'first\nsecond'); assert.equal(opts.model, undefined)
  assert.deepEqual(events.map((e) => e.t), ['delta', 'tool'])
})

test('requires ChatGPT account, never silently falls back to API billing', async () => {
  for (const account of [null, { type: 'apiKey' }]) {
    const c = fake({ account })
    await assert.rejects(runCodex({ clientFactory: () => c, prompt: 'hello' }), /Sign in with ChatGPT/)
    assert.equal(c.requests.some((r) => r.method === 'turn/start'), false); assert.equal(c.closed, true)
  }
})

test('failed/interrupted turn and disconnected stream reject even after partial text', async () => {
  for (const status of ['failed', 'interrupted', 'closed']) {
    const c = fake({ turn(c) { message(c, 'partial'); status === 'closed' ? c.close() : complete(c, status) } })
    await assert.rejects(runCodex({ clientFactory: () => c, prompt: 'hello' }), new RegExp(status))
  }
})

test('abort, timeout and tool budget terminate the child', async () => {
  const controller = new AbortController()
  const a = fake({ turn() { controller.abort() } })
  await assert.rejects(runCodex({ clientFactory: () => a, prompt: 'hello', abortController: controller }), /cancelled/)
  const b = fake()
  await assert.rejects(runCodex({ clientFactory: () => b, prompt: 'hello', timeoutMs: 10 }), /timed out/)
  const c = fake({ async turn(c) { for (let i = 1; i <= 9; i++) await c.onRequest({ id: i, method: 'item/tool/call', params: { threadId: 'thread', tool: 'lookup', arguments: {} } }) } })   // 上限 0 + 宽限 8,第 9 次停
  await assert.rejects(runCodex({ clientFactory: () => c, prompt: 'hello', maxTurns: 0, tools: [{ name: 'lookup', description: 'Lookup', shape: {}, handler() { assert.fail('over budget') } }] }), /limit reached/)
  assert.equal(c.sent.filter((x) => /Tool budget/.test(x.result?.contentItems?.[0]?.text)).length, 8)
  assert.ok(a.closed && b.closed && c.closed)
})

test('login retains callback process until completion; status never returns tokens', async () => {
  const c = fake()
  const login = await chatgptLogin('test-home', () => c)
  assert.match(login.authUrl, /^https:/); assert.equal(c.closed, false)
  assert.equal((await chatgptStatus('test-home', () => assert.fail())).pending, true)
  c.emit('account/login/completed', { success: true })
  assert.equal(c.closed, true)
  const s = await chatgptStatus('test-home', () => fake())
  assert.deepEqual(s, { connected: true, email: 'student@example.com', plan: 'plus' })
})

test('JSONL RPC handles fragmented responses, rejects server errors and pending requests on exit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-codex-rpc-'))
  const child = new EventEmitter()
  Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {}, exitCode: 0 })
  const c = new CodexClient({ dataDir: dir, binary: 'mock', spawnImpl: () => child })
  try {
    const p = c.request('test'); child.stdout.write('{"id":1,"res'); child.stdout.write('ult":{"ok":true}}\n')
    assert.deepEqual(await p, { ok: true })
    const q = c.request('test'); child.stdout.write('{"id":2,"error":{"message":"nope"}}\n'); await assert.rejects(q, /nope/)
    const r = c.request('test'); child.emit('exit', 1); await assert.rejects(r, /closed/)
  } finally { c.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('failed login is visible and a fresh attempt clears the error', async () => {
  const c = fake()
  await chatgptLogin('failed-login', () => c)
  c.emit('account/login/completed', { success: false, error: 'access denied' })
  assert.equal((await chatgptStatus('failed-login', () => assert.fail())).error.message, 'access denied')
  const retry = fake()
  assert.equal((await chatgptLogin('failed-login', () => retry)).pending, true)
  retry.emit('account/login/completed', { success: true })
  assert.equal((await chatgptStatus('failed-login', () => fake())).connected, true)
})

test('tool budget: over the limit the model is told to answer now instead of the run dying', async () => {
  let called = 0
  const c = fake({ async turn(c) {
    await c.onRequest({ id: 1, method: 'item/tool/call', params: { threadId: 'thread', callId: 'a', tool: 'lookup', arguments: {} } })
    await c.onRequest({ id: 2, method: 'item/tool/call', params: { threadId: 'thread', callId: 'b', tool: 'lookup', arguments: {} } })
    message(c, 'final answer'); complete(c)
  } })
  const r = await runCodex({ clientFactory: () => c, prompt: 'hello', maxTurns: 1, tools: [{ name: 'lookup', description: 'Lookup', shape: {}, handler: async () => { called++; return 'ok' } }] })
  assert.equal(called, 1)
  assert.match(c.sent[1].result.contentItems[0].text, /Tool budget \(1 calls\)/)
  assert.deepEqual(r.blocks.map((b) => b.type), ['tool_use', 'text'])
})

test('device authorization exposes only the user code and survives polling, isolated per account', async () => {
  const clients = []
  const factory = () => {
    const c = fake(); const request = c.request.bind(c)
    c.request = async (method, params) => {
      if (method === 'account/login/start') {
        assert.equal(params.type, 'chatgptDeviceCode')
        return { verificationUrl: 'https://auth.openai.com/codex/device', userCode: `CODE-${clients.length}`, loginId: 'private-id', accessToken: 'never-expose' }
      }
      return request(method, params)
    }
    clients.push(c); return c
  }
  const a = await chatgptLogin('device-a', factory, { deviceCode: true })
  const b = await chatgptLogin('device-b', factory, { deviceCode: true })
  assert.equal(a.userCode, 'CODE-1'); assert.equal(b.userCode, 'CODE-2')
  assert.deepEqual(await chatgptStatus('device-a', () => assert.fail()), { connected: false, ...a })
  assert.deepEqual(await chatgptLogin('device-a', () => assert.fail(), { deviceCode: true }), a)
  assert.equal(a.accessToken, undefined); assert.equal(a.loginId, undefined)
  clients[0].emit('account/login/completed', { success: true })
  assert.equal((await chatgptStatus('device-a', () => fake())).connected, true)
  assert.equal((await chatgptStatus('device-b', () => assert.fail())).pending, true)
  clients[1].emit('account/login/completed', { success: false, error: 'expired' })
  assert.equal((await chatgptStatus('device-b', () => assert.fail())).error.message, 'expired')
})

test('restart replaces only this account device login and ignores old completion events', async () => {
  const make = (code) => {
    const c = fake(); const request = c.request.bind(c)
    c.request = async (method, params) => method === 'account/login/start'
      ? { verificationUrl: 'https://auth.openai.com/codex/device', userCode: code }
      : request(method, params)
    return c
  }
  const old = make('OLD'), other = make('OTHER'), fresh = make('NEW')
  await chatgptLogin('restart-a', () => old, { deviceCode: true })
  await chatgptLogin('restart-b', () => other, { deviceCode: true })
  const result = await chatgptLogin('restart-a', () => fresh, { deviceCode: true, restart: true })
  assert.equal(old.closed, true); assert.equal(other.closed, false)
  assert.equal(result.userCode, 'NEW')
  old.emit('account/login/completed', { success: false, error: 'late old failure' })
  assert.equal((await chatgptStatus('restart-a', () => assert.fail())).userCode, 'NEW')
  assert.equal((await chatgptStatus('restart-b', () => assert.fail())).userCode, 'OTHER')
  fresh.emit('account/login/completed', { success: true })
  other.emit('account/login/completed', { success: true })
  assert.equal((await chatgptStatus('restart-a', () => fake())).connected, true)
})

test('restart failure clears the old code and permits another attempt', async () => {
  const old = fake()
  await chatgptLogin('retry-fail', () => old)
  const broken = fake(); broken.init = async () => { throw new Error('network unavailable') }
  await assert.rejects(chatgptLogin('retry-fail', () => broken, { restart: true }), /network unavailable/)
  const status = await chatgptStatus('retry-fail', () => assert.fail())
  assert.equal(status.pending, undefined); assert.equal(status.userCode, undefined)
  assert.match(status.error.message, /network unavailable/)
  assert.ok(old.closed && broken.closed)
  const fresh = fake()
  assert.equal((await chatgptLogin('retry-fail', () => fresh, { restart: true })).pending, true)
  fresh.emit('account/login/completed', { success: true })
})
