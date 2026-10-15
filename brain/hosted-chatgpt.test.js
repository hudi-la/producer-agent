import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { withTenant } from './tenant.js'
import { handleHostedRoute } from './hosted/routes.js'

function tenant(owner) {
  const writes = []
  return { owner, dataDir: `/private/users/${owner}`, email: `${owner}@example.com`, marks: {}, settings: {}, writes,
    db: { async rpc(name, args) { writes.push({ name, args }); return {} } } }
}
async function call(t, method, url, body, auth) {
  const req = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), { method, url })
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, writeHead(code) { this.code = code }, end(raw) { this.body = JSON.parse(raw) } }
  await withTenant(t, () => handleHostedRoute(req, res, { hosted: { invalidate() {} }, chatgptAuth: auth }))
  return res
}
test('hosted auth routes require identity and enforce HTTP methods', async () => {
  assert.equal((await call(null, 'POST', '/chatgpt/login', {}, {})).code, 401)
  assert.equal((await call(tenant('a'), 'GET', '/chatgpt/login', null, {})).code, 405)
})
test('device login/status remain scoped to authenticated tenant directories', async () => {
  const seen = []
  const auth = { async login(dir) { seen.push(dir); return { pending: true, userCode: dir.endsWith('/a') ? 'AAAA' : 'BBBB', authUrl: 'https://auth.openai.com/codex/device' } }, async status(dir) { return { connected: dir.endsWith('/a') } } }
  const a = tenant('a'), b = tenant('b')
  const [ra, rb] = await Promise.all([call(a, 'POST', '/chatgpt/login', { dataDir: b.dataDir }, auth), call(b, 'POST', '/chatgpt/login', {}, auth)])
  assert.deepEqual(seen.sort(), [a.dataDir, b.dataDir]); assert.equal(ra.body.userCode, 'AAAA'); assert.equal(rb.body.userCode, 'BBBB')
  assert.equal(ra.headers['Cache-Control'], 'no-store')
  assert.equal((await call(b, 'GET', '/chatgpt/status', null, auth)).body.connected, false)
})
test('setup requires real authorization, then saves provider and onboarding without tokens', async () => {
  const t = tenant('a'); let connected = false
  const auth = { async status(dir) { assert.equal(dir, t.dataDir); return { connected } } }
  const body = { provider: 'chatgpt-subscription', onboarded: true, chatgptConnected: true }
  assert.equal((await call(t, 'POST', '/setup', body, auth)).code, 400); assert.equal(t.writes.length, 0)
  connected = true
  const r = await call(t, 'POST', '/setup', body, auth)
  assert.equal(r.code, 200); assert.equal(r.body.ready, true)
  assert.deepEqual(t.writes[0].args.p, { provider: 'chatgpt-subscription', onboarded: true })
  // A freshly hydrated tenant has no cached connected flag; GET must check credentials again.
  t.settings = { provider: 'chatgpt-subscription' }
  assert.equal((await call(t, 'GET', '/settings', null, auth)).body.ready, true)
  connected = false
  assert.equal((await call(t, 'GET', '/settings', null, auth)).body.ready, false)
})
test('missing directory and auth failures cannot save a subscription as ready', async () => {
  const t = tenant('a'); t.dataDir = ''
  const auth = { async status() { throw new Error('disconnected') } }
  assert.equal((await call(t, 'POST', '/settings', { provider: 'chatgpt-subscription' }, auth)).code, 503)
  assert.equal(t.writes.length, 0)
  assert.equal((await call(t, 'POST', '/chatgpt/login', {}, auth)).code, 503)
})
test('skip onboarding works without ChatGPT authentication', async () => {
  const t = tenant('a')
  const r = await call(t, 'POST', '/setup', { skip: true, onboarded: true }, {})
  assert.equal(r.code, 200); assert.equal(r.body.ready, false); assert.equal(t.settings.onboarded, true)
})
