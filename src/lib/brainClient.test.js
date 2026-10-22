// src/lib/brainClient.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brainClient } from './brainClient.js'

const calls = []
const fakeFetch = (reply) => async (url, init = {}) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => reply, headers: { get: () => 'text/plain' }, arrayBuffer: async () => new ArrayBuffer(2) } }

test('from 链序列化成一个 POST /db/from', async () => {
  calls.length = 0
  const c = brainClient('http://b', fakeFetch({ data: [{ id: 1 }], error: null }))
  const r = await c.from('v_pa_entries').select('id, title').eq('kind', 'work').in('id', ['a']).order('title', { ascending: false }).limit(5)
  assert.equal(calls[0].url, 'http://b/db/from')
  assert.deepEqual(JSON.parse(calls[0].init.body), { view: 'v_pa_entries', select: 'id, title', filters: [['eq', 'kind', 'work'], ['in', 'id', ['a']]], order: [{ col: 'title', ascending: false }], limit: 5, single: null, count: null, head: false })
  assert.deepEqual(r, { data: [{ id: 1 }], error: null })
})

test('maybeSingle 带 single:"maybe"', async () => {
  calls.length = 0
  const c = brainClient('http://b', fakeFetch({ data: null, error: null }))
  await c.from('v_pa_profile').select('*').maybeSingle()
  assert.equal(JSON.parse(calls[0].init.body).single, 'maybe')
})

test('rpc → POST /db/rpc/<name>', async () => {
  calls.length = 0
  const c = brainClient('http://b', fakeFetch({ data: 6, error: null }))
  assert.deepEqual(await c.rpc('pa_x', { p_a: 1 }), { data: 6, error: null })
  assert.equal(calls[0].url, 'http://b/db/rpc/pa_x'); assert.deepEqual(JSON.parse(calls[0].init.body), { p_a: 1 })
})

test('网络炸了 → error 不抛', async () => {
  const c = brainClient('http://b', async () => { throw new Error('boom') })
  const r = await c.rpc('pa_x', {}); assert.equal(r.data, null); assert.match(r.error.message, /boom/)
})

test('auth:/me ready → 有会话;未 ready → null 但带 local 标记', async () => {
  const c1 = brainClient('http://b', fakeFetch({ mode: 'local', ready: true, user: { id: 'u', email: 'e' } }))
  const s1 = await c1.auth.getSession(); assert.equal(s1.data.session.user.id, 'u'); assert.equal(s1.data.session.local, true)
  const c2 = brainClient('http://b', fakeFetch({ mode: 'local', ready: false, user: null }))
  const s2 = await c2.auth.getSession(); assert.equal(s2.data.session, null); assert.equal(s2.data.local, true)
  const sub = c2.auth.onAuthStateChange(() => {}); assert.equal(typeof sub.data.subscription.unsubscribe, 'function')
})

test('storage:签名 URL 直接拼,不问网络', async () => {
  const c = brainClient('http://b', fakeFetch({}))
  assert.deepEqual(await c.storage.from('pursuit-files').createSignedUrl('a/b.txt', 60), { data: { signedUrl: 'http://b/files/a%2Fb.txt' }, error: null })
})

test('settings:get 走 GET /settings,set 走 POST', async () => {
  calls.length = 0
  const c = brainClient('http://b', fakeFetch({ email: 'e', apiKeySet: true, apiKeyHint: 'sk-ant-…1234' }))
  const g = await c.settings.get(); assert.equal(g.apiKeyHint, 'sk-ant-…1234'); assert.equal(calls[0].url, 'http://b/settings')
  await c.settings.set({ model: 'x' }); assert.equal(calls[1].init.method, 'POST'); assert.deepEqual(JSON.parse(calls[1].init.body), { model: 'x' })
})

test('from:is / or / count+head 也序列化', async () => {
  calls.length = 0
  const c = brainClient('http://b', fakeFetch({ data: null, error: null, count: 3 }))
  const r = await c.from('v_pa_unknown_senders').select('*', { count: 'exact', head: true }).is('x', null).or('a.ilike.%q%')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.count, 'exact'); assert.equal(body.head, true); assert.deepEqual(body.filters, [['is', 'x', null], ['or', 'a.ilike.%q%', null]])
  assert.equal(r.count, 3)
})

test('HTTP failures with empty JSON cannot masquerade as successful writes', async () => {
  const c = brainClient('http://b', async () => ({ ok: false, status: 403, json: async () => ({}) }))
  for (const r of [await c.settings.set({ lang: 'en' }), await c.storage.from('x').remove(['x']), await c.setup({})]) {
    assert.equal(r.ok, false); assert.match(r.error.message, /403/)
  }
})

test('read failures stay errors rather than empty backup/tool lists or first-run sessions', async () => {
  const c = brainClient('http://b', async () => { throw new Error('Failed to fetch') })
  for (const r of [await c.backup.list(), await c.mcpTargets.list(), await c.judgments.files(), await c.settings.get(), await c.auth.getSession()]) {
    assert.match(r.error.message, /Failed to fetch/)
  }
})

test('malformed responses and nested service errors remain readable', async () => {
  const malformed = brainClient('http://b', async () => ({ ok: false, status: 502, json: async () => { throw new Error('Unexpected token') } }))
  assert.match((await malformed.claude.login()).error.message, /502: invalid response/)
  const nested = brainClient('http://b', fakeFetch({ error: { message: 'invalid token' } }))
  assert.equal((await nested.chatgpt.login()).error.message, 'invalid token')
})

test('backup export rejects HTTP errors and import preserves partial-success details', async () => {
  const broken = brainClient('http://b', async () => ({ ok: false, status: 401, json: async () => ({ error: 'expired token' }) }))
  await assert.rejects(() => broken.backup.export(), /401.*expired token/)
  const partial = { ok: true, files: 1, failed: [{ key: 'image.png', error: 'disk full' }] }
  assert.deepEqual(await brainClient('http://b', fakeFetch(partial)).backup.import(new Blob()), partial)
})

test('null service payload is a readable error, not a broken component', async () => {
  const c = brainClient('http://b', fakeFetch(null))
  assert.match((await c.settings.get()).error.message, /invalid response/)
  assert.match((await c.auth.getSession()).error.message, /invalid response/)
})
