import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { handleCalendarRoute } from './routes.js'
function request(path, body, method = 'POST') { const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]); req.method = method; req.url = path; return req }
function response() { return { writeHead(code) { this.code = code }, end(raw) { this.body = JSON.parse(raw) } } }
test('Calendar routes reject requests without a tenant', async () => {
  const res = response(); await handleCalendarRoute(request('/calendar/status', undefined, 'GET'), res, { tenant: () => null, service: {} }); assert.equal(res.code, 401)
})
test('Sync uses authenticated owner and database states, never client-provided events', async () => {
  const rows = [{ subject_id: 'actual' }]; let args
  const t = { owner: 'alice', mode: 'hosted', settings: {}, db: { from: (name) => { assert.equal(name, 'v_pa_state'); return { select: async () => ({ data: rows }) } } } }
  const res = response(); await handleCalendarRoute(request('/calendar/sync', { owner: 'bob', events: [{ subject_id: 'forged' }], key: 'key' }), res, { tenant: () => t, service: { sync: async (...a) => { args = a; return {} } } })
  assert.equal(res.code, 200); assert.equal(args[0], 'alice'); assert.deepEqual(args[1], rows)
})
