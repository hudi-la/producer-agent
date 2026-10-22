import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactFields } from './artifacts.js'
test('mail artifacts bind to their source message and preserve reply identity', () => {
  const out = artifactFields({ id: 'one', meta: { letter: { to: 'a@example.com', subject: 'Hi', body: 'Original', thread_id: 't' } } })
  assert.equal(out.p_meta.artifact_message_id, 'one')
  assert.equal(out.p_meta.thread_id, 't'); assert.equal(out.p_body, 'Original')
})
test('forms preserve limits separately from editable answers', () => {
  const out = artifactFields({ id: 'two', meta: { form: { title: 'Application', fields: [{ key: 'q1', q: 'Why?', words: [0, 100], a: 'Answer' }] } } })
  assert.deepEqual(out.p_rules.fields, [{ key: 'q1', q: 'Why?', words: [0, 100] }])
  assert.deepEqual(out.p_meta.answers, { q1: 'Answer' })
  assert.throws(() => artifactFields(null), /没有/)
})
