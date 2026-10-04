import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createErrorReporter } from './errorTelemetry.js'
import { safeErrorEvent, ERROR_LOG_RELEASE } from '../../brain/errorEvents.js'
const id = '11111111-1111-4111-8111-111111111111'
const settle = () => new Promise((r) => setImmediate(r))
const memory = () => { let value = null; return { getItem: () => value, setItem: (_, v) => { value = v } } }

test('client sends only allowlisted diagnostic metadata, never text, keys, identities or URLs', async () => {
  let sent
  const report = createErrorReporter({ send: async (e) => { sent = e; return true }, now: () => 100000, uuid: () => id })
  assert.equal(report.report(new Error('HTTP 401 secret-user@example.com token=secret-token private conversation'), 'settings https://example.com?key=private'), id)
  await settle()
  assert.deepEqual(sent, { id, kind: 'auth', operation: 'settings', status: 401, occurredAt: new Date(100000).toISOString(), release: ERROR_LOG_RELEASE })
})
test('offline metadata survives reload; retries without recursive errors or duplicate notices', async () => {
  const storage = memory(); let sends = 0
  const reporter = createErrorReporter({ storage, uuid: () => id, send: async () => { sends++; return false } })
  reporter.report('Failed to fetch private text', 'backup')
  reporter.report('Failed to fetch private text', 'backup')
  await settle(); assert.equal(sends, 1)
  assert.ok(!storage.getItem().includes('private'))
  const restored = createErrorReporter({ storage, send: async () => { sends++; return true } })
  await restored.flush(); assert.equal(sends, 2); assert.deepEqual(JSON.parse(storage.getItem()), [])
})
test('retention discards old queued errors and bounds the queue', async () => {
  const storage = memory(); let n = 0, clock = 0
  const reporter = createErrorReporter({ storage, now: () => clock, uuid: () => `11111111-1111-4111-8111-${String(++n).padStart(12, '0')}`, send: async () => false })
  for (let i = 0; i < 60; i++) { clock += 61000; reporter.report('Failed to fetch', 'backup'); await settle() }
  assert.equal(JSON.parse(storage.getItem()).length, 50)
  clock += 86400001; await reporter.flush(); assert.deepEqual(JSON.parse(storage.getItem()), [])
})
test('wire validation rejects malformed codes and drops arbitrary fields even when spoofed', () => {
  assert.equal(safeErrorEvent({ id, kind: 'secret-content', operation: 'backup' }), null)
  const safe = safeErrorEvent({ id, kind: 'auth', operation: 'model', message: 'secret', email: 'private', release: 'token=secret', requestId: 'not-an-id' })
  assert.deepEqual(safe, { id, kind: 'auth', operation: 'model', release: 'unknown' })
})
