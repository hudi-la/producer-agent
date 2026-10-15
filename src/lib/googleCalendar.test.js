import { test } from 'node:test'
import assert from 'node:assert/strict'
import { googleRows } from './googleCalendar.js'
const min = new Date(2026, 9, 1), max = new Date(2026, 10, 1)
test('All-day events preserve local dates and exclusive end dates', () => {
  const out = googleRows([{ id: '1', calendarId: 'a', start: { date: '2026-10-08' }, end: { date: '2026-10-10' }, htmlLink: 'javascript:alert(1)' }], min, max)
  assert.deepEqual(out.map((x) => x.day), ['2026-10-08', '2026-10-09']); assert.equal(out[0].htmlLink, null)
})
test('Timed events crossing midnight appear on both days, without duplicate copies', () => {
  const e = { id: '1', calendarId: 'a', start: { dateTime: new Date(2026, 9, 8, 23).toISOString() }, end: { dateTime: new Date(2026, 9, 9, 1).toISOString() } }
  assert.deepEqual(googleRows([e, e], min, max).map((x) => x.day), ['2026-10-08', '2026-10-09'])
})
