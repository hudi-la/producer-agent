import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { createErrorLog, createDiagnosticsHandler, observeRequest } from './errorLog.js'
import { ERROR_LOG_RELEASE } from './errorEvents.js'
const id = '11111111-1111-4111-8111-111111111111'
const event = { id, kind: 'auth', operation: 'settings', release: ERROR_LOG_RELEASE }
const response = () => ({ statusCode: null, writeHead(status) { this.statusCode = status; return this }, end(body) { this.body = JSON.parse(body) } })
function request(body, origin = 'https://fairwind.test', type = 'application/json') { const r = Readable.from([typeof body === 'string' ? body : JSON.stringify(body)]); r.method = 'POST'; r.headers = { origin, 'content-type': type }; return r }

test('private bounded log files redact by allowlist, rotate and expire without new traffic', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fw-errors-'))
  try {
    const log = createErrorLog({ dir, maxBytes: 250, rotations: 2, retentionMs: 1000 })
    for (let i = 0; i < 8; i++) assert.equal(await log.write({ ...event, message: 'super-secret', user: 'private-email' }), true)
    assert.ok((await readdir(dir)).length <= 3)
    const file = join(dir, 'errors.jsonl'), text = await readFile(file, 'utf8')
    assert.ok(!text.includes('secret')); assert.ok(!text.includes('private-email'))
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    await writeFile(file, JSON.stringify({ ...event, at: new Date(0).toISOString() }) + '\n' + text)
    await log.prune(); assert.ok(!(await readFile(file, 'utf8')).includes('1970-01-01'))
    await utimes(file, new Date(0), new Date(0)); await log.prune()
    assert.ok(!(await readdir(dir)).includes('errors.jsonl'))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('intake rejects foreign origins, invalid payloads and oversized bodies; repeated IDs only save once', async () => {
  const events = []
  const handle = createDiagnosticsHandler({ log: { write: async (e) => { events.push(e); return true } }, allowOrigin: (o) => o === 'https://fairwind.test' })
  for (const [req, status] of [[request(event, 'https://evil.test'), 403], [request(event, undefined, 'text/plain'), 415], [request('bad json'), 400], [request('x'.repeat(2049)), 413], [request(event), 201], [request(event), 200]]) {
    const res = response(); await handle(req, res); assert.equal(res.statusCode, status)
  }
  assert.equal(events.length, 1)
})
test('intake caps request rate and does not claim success if disk logging fails', async () => {
  const handle = createDiagnosticsHandler({ log: { write: async () => false }, now: () => 100000, allowOrigin: () => true })
  for (let i = 0; i < 121; i++) { const res = response(); await handle(request(event), res); assert.equal(res.statusCode, i < 120 ? 503 : 429) }
})
test('HTTP and SSE failures use server-generated IDs and never persist route query secrets', async () => {
  const events = [], res = new EventEmitter(); res.statusCode = 401; res.setHeader = () => {}
  const requestId = observeRequest({ url: '/settings?apiKey=secret' }, res, { write: async (e) => { events.push(e); return true } })
  res.emit('finish'); await res.recordStreamFailure()
  assert.equal(events[0].requestId, requestId); assert.equal(events[0].kind, 'auth')
  assert.equal(events[1].kind, 'model'); assert.ok(!JSON.stringify(events).includes('secret'))
})
