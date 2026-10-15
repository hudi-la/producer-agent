import test from 'node:test'
import assert from 'node:assert/strict'
import { scoutToastState } from './scoutToast.js'

const now = Date.parse('2026-10-08T12:00:00Z')
const base = { id: 'a', name: 'Weekly scout', type: 'scout_aggregators', prompt: 'Find calls' }

test('queued, running, resumed, paused, failed and complete are distinct', () => {
  assert.equal(scoutToastState([{ ...base, run_now: true }], now).kind, 'queued')
  assert.equal(scoutToastState([{ ...base, running_since: new Date(now).toISOString() }], now).kind, 'running')
  const q = { status: 'paused', completed: 2, added: 1, units: [{ done: true }], candidates: [{ done: false }] }
  assert.equal(scoutToastState([{ ...base, config: { scout_progress: q }, running_since: new Date(now).toISOString() }], now).kind, 'resuming')
  const paused = scoutToastState([{ ...base, config: { scout_progress: q } }], now)
  assert.equal(paused.kind, 'paused')
  assert.equal(paused.remaining, 1)
  assert.equal(scoutToastState([{ ...base, config: { scout_progress: { ...q, status: 'failed' } } }], now).kind, 'failed')
  assert.equal(scoutToastState([{ ...base, last_run_at: new Date(now).toISOString(), last_result: 'done' }], now).kind, 'complete')
  assert.equal(scoutToastState([{ ...base, last_run_at: new Date(now).toISOString(), last_result: '⚠️ search partial' }], now).kind, 'failed')
})

test('repeated queue request stays queued and an old completion does not reappear', () => {
  const old = new Date(now - 31 * 60_000).toISOString()
  assert.equal(scoutToastState([{ ...base, last_run_at: old }], now), null)
  assert.equal(scoutToastState([{ ...base, last_run_at: old, run_now: true }], now).kind, 'queued')
  assert.equal(scoutToastState([{ ...base, last_run_at: old, run_now: true, running_since: new Date(now).toISOString() }], now).kind, 'running')
  assert.equal(scoutToastState([{ ...base, running_since: new Date(now - 3 * 60 * 60_000).toISOString() }], now).kind, 'stalled')
})
