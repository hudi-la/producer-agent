import { test } from 'node:test'
import assert from 'node:assert/strict'
import { persistRejudgment } from './rejudge-record.js'
const subject = { kind: 'pursuit', id: 'subject', upto: '2026-10-23T12:00:00Z', last_in_id: 'mail' }
const verdict = { touch: null, why: null, needs_reply: true, reply_why: 'Question' }
const names = ['pa_set_next_touch', 'pa_recompute_touch', 'pa_mark_judged']
for (const fail of names) test(`failure at ${fail} cannot report a completed judgment`, async () => {
  const seen = []
  const db = { rpc: async name => { seen.push(name); return name === fail ? { error: { message: 'unavailable' } } : { data: true } } }
  await assert.rejects(persistRejudgment(db, subject, verdict), /unavailable/)
  assert.deepEqual(seen, names.slice(0, names.indexOf(fail) + 1))
})
test('successful writes mark the input snapshot, not later events', async () => {
  const seen = []
  await persistRejudgment({ rpc: async (name, args) => { seen.push([name, args]); return { data: true } } }, subject, verdict)
  assert.deepEqual(seen.map(x => x[0]), names)
  assert.equal(seen.at(-1)[1].p_upto, subject.upto)
})
test('missing snapshot refuses all writes', async () => {
  await assert.rejects(persistRejudgment({ rpc: () => assert.fail('must not write') }, { ...subject, upto: null }, verdict), /snapshot/)
})
