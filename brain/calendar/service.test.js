import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCalendarService, eventBody, sourceKey, SCOPES } from './service.js'
const meeting = { subject_kind: 'contact', subject_id: 'person1', subject_name: 'Person', state: 'MEETING_SET', anchor_id: 'message1', due_at: '2026-10-10T15:00:00-07:00', what: 'Meet' }
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'calendar-test-')); t.after(() => rm(root, { recursive: true, force: true }))
  let clock = Date.parse('2026-10-08T12:00:00Z'), calls = [], scopes = SCOPES
  const entries = new Map()
  const makeClient = () => ({ credentials: {}, generateAuthUrl: (opts) => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ state: opts.state }), getToken: async ({ code }) => ({ tokens: { refresh_token: code, scope: scopes.join(' ') } }), setCredentials(token) { this.credentials = token } })
  const makeApi = (c) => {
    const account = c.credentials.refresh_token
    return { calendars: { get: async () => ({ data: { id: account + '@example.com', timeZone: 'America/Los_Angeles' } }), insert: async () => ({ data: { id: account + '-fairwind' } }) },
      calendarList: { list: async () => ({ data: { items: [{ id: account + '-fairwind', summary: 'Fairwind', accessRole: 'owner' }, { id: 'readonly', accessRole: 'reader' }] } }) },
      events: { get: async ({ eventId }) => { const data = entries.get(account + ':' + eventId); if (!data) throw { code: 404 }; return { data: structuredClone(data) } },
        insert: async ({ requestBody }) => { calls.push(['insert', account, requestBody]); const data = { ...requestBody, etag: 'v1', htmlLink: 'https://calendar.google.com/calendar/event?eid=test' }; entries.set(account + ':' + data.id, data); return { data: structuredClone(data) } },
        patch: async ({ eventId, requestBody }, opts) => { calls.push(['patch', account, opts]); const data = { ...entries.get(account + ':' + eventId), ...requestBody, etag: 'v2' }; entries.set(account + ':' + eventId, data); return { data: structuredClone(data) } },
        list: async () => ({ data: { items: [] } }) } }
  }
  const service = createCalendarService({ root, makeClient, makeApi, origin: 'https://fairwind.hudiworks.com', now: () => clock })
  const connect = async (owner, code = owner) => { const { url } = service.start(owner); const state = new URL(url).searchParams.get('state'); await service.callback(state, code); return state }
  return { service, root, connect, entries, calls, advance: (ms) => clock += ms, scope: (s) => scopes = s }
}
test('OAuth state is single use, expires and requires every calendar scope', async (t) => {
  const x = await setup(t), state = await x.connect('alice')
  await assert.rejects(x.service.callback(state, 'alice'), /expired/)
  const stale = new URL(x.service.start('alice').url).searchParams.get('state'); x.advance(600001)
  await assert.rejects(x.service.callback(stale, 'alice'), /expired/)
  x.scope([]); await assert.rejects(x.connect('bob'), /scope_missing/)
  assert.equal((await x.service.status('bob')).connected, false)
})
test('User credentials, target calendars and public status stay isolated', async (t) => {
  const x = await setup(t); await x.connect('alice'); await x.connect('bob')
  await x.service.configure('alice', { target: 'alice-fairwind' })
  assert.equal((await x.service.status('bob')).target, '')
  await assert.rejects(x.service.configure('bob', { target: 'alice-fairwind' }), /not_writable/)
  assert.ok(!JSON.stringify(await x.service.status('alice')).includes('refreshToken'))
  assert.equal((await stat(join(x.root, 'users/alice/calendar.json'))).mode & 0o777, 0o600)
  await assert.rejects(x.service.status('../alice'), /bad_owner/)
})
test('Repeated and concurrent exports create only one event; updates use conditional patch', async (t) => {
  const x = await setup(t); await x.connect('alice'); await x.service.configure('alice', { target: 'alice-fairwind' })
  const opts = { key: sourceKey(meeting) }
  await Promise.all([x.service.sync('alice', [meeting], opts), x.service.sync('alice', [meeting], opts)])
  assert.equal(x.calls.length, 1); assert.equal(x.calls[0][2].attendees, undefined)
  await x.service.sync('alice', [{ ...meeting, due_at: '2026-10-11T22:00:00Z' }], opts)
  assert.equal(x.calls[1][0], 'patch'); assert.equal(x.calls[1][2].headers['If-Match'], 'v1')
})
test('Google edits and deletions are preserved as conflicts', async (t) => {
  const x = await setup(t); await x.connect('alice'); await x.service.configure('alice', { target: 'alice-fairwind' })
  const opts = { key: sourceKey(meeting) }; await x.service.sync('alice', [meeting], opts)
  const event = [...x.entries.values()][0]; event.summary = 'Changed by user'
  assert.equal((await x.service.sync('alice', [meeting], opts)).results[0].status, 'conflict')
  x.entries.clear()
  assert.equal((await x.service.sync('alice', [meeting], opts)).results[0].status, 'conflict')
  assert.equal(x.calls.length, 1)
})
test('Automatic sync is opt-in and only exports future confirmed meetings', async (t) => {
  const x = await setup(t); await x.connect('alice'); await x.service.configure('alice', { target: 'alice-fairwind' })
  await x.service.sync('alice', [meeting], { automatic: true }); assert.equal(x.calls.length, 0)
  await x.service.configure('alice', { autoSync: true })
  await x.service.sync('alice', [meeting, { ...meeting, state: 'NEEDS_REPLY' }, { ...meeting, due_at: '2020-01-01T12:00Z' }], { automatic: true })
  assert.equal(x.calls.length, 1)
})
test('Disconnect clears credentials and switching Google accounts clears old preferences', async (t) => {
  const x = await setup(t); await x.connect('alice'); await x.service.configure('alice', { target: 'alice-fairwind', autoSync: true })
  await x.connect('alice', 'other'); assert.equal((await x.service.status('alice')).target, '')
  await x.service.disconnect('alice'); assert.equal((await x.service.status('alice')).connected, false)
  await assert.rejects(x.service.events('alice', '2026-10-01', '2026-10-31'), /not_connected/)
})
test('Task dates use the account timezone; meetings have explicit 30-minute duration', () => {
  const task = eventBody({ ...meeting, state: 'NEEDS_REPLY', due_at: '2026-10-10T01:00:00Z' }, 'America/Los_Angeles', 'https://example.com')
  assert.deepEqual(task.start, { date: '2026-10-09' }); assert.deepEqual(task.end, { date: '2026-10-10' })
  const event = eventBody(meeting, 'America/Los_Angeles', 'https://example.com')
  assert.equal(Date.parse(event.end.dateTime) - Date.parse(event.start.dateTime), 1800000)
})
test('Unknown item keys and excessive date ranges are rejected', async (t) => {
  const x = await setup(t); await x.connect('alice')
  await assert.rejects(x.service.sync('alice', [], { key: 'forged' }), /item_changed/)
  await assert.rejects(x.service.events('alice', '2026-01-01', '2027-01-01'), /invalid_range/)
})

test('A Calendar API failure preserves the OAuth grant and exposes a durable error', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'calendar-callback-')); t.after(() => rm(root, { recursive: true, force: true }))
  let enabled = false
  const service = createCalendarService({ root, origin: 'https://example.com', makeClient: () => ({
    generateAuthUrl: (o) => 'https://accounts.google.com/?state=' + o.state,
    getToken: async () => ({ tokens: { refresh_token: 'retained', scope: SCOPES.join(' ') } }), setCredentials() {},
  }), makeApi: () => ({ calendars: { get: async () => {
    if (!enabled) throw { code: 403, response: { data: { error: { details: [{ reason: 'SERVICE_DISABLED' }] } } } }
    return { data: { id: 'account@example.com' } }
  } }, calendarList: { list: async () => ({ data: { items: [] } }) } }) })
  const state = new URL(service.start('alice').url).searchParams.get('state')
  await assert.rejects(service.callback(state, 'code'), /calendar_api_disabled/)
  assert.equal((await service.status('alice')).connected, true)
  assert.equal((await service.status('alice')).syncError, 'calendar_api_disabled')
  assert.equal((await service.status('alice')).address, '')
  enabled = true
  assert.equal((await service.list('alice')).address, 'account@example.com')
  assert.equal((await service.status('alice')).syncError, null)
})
