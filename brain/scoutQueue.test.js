import test from 'node:test'
import assert from 'node:assert/strict'
import { scoutSources, freshScoutQueue, resumeScoutQueue, addCandidates, parseCandidates, queueRemaining } from './scoutQueue.js'

const prompt = `== Sources ==
- https://a.org/calls/
- https://a.org/calls/
- "open call" installation art 2027 deadline
- https://b.org/opportunities
== Screening ==
- Skip vanity awards.`

test('editable sources and search queries become distinct work items', () => {
  assert.deepEqual(scoutSources(prompt).map((x) => [x.kind, x.value]), [
    ['source', 'https://a.org/calls'], ['search', '"open call" installation art 2027 deadline'],
    ['source', 'https://b.org/opportunities'],
  ])
})

test('section headings containing WebSearch are not extra model calls', () => {
  const lines = '【一】固定聚合源（用 WebFetch / WebSearch）\n- https://a.org/calls\n【二】搜索（用 WebSearch）\n- "open call" installation 2027'
  assert.deepEqual(scoutSources(lines).map((x) => x.kind), ['source', 'search'])
})

test('resume keeps completed work; editing the prompt builds a new queue', () => {
  const q = freshScoutQueue(prompt, '2026-10-08T00:00:00Z')
  q.units[0].done = true
  addCandidates(q, ['https://official.org/call', 'https://official.org/call/'], 'A')
  q.candidates[0].done = true
  assert.equal(queueRemaining(q), 2)
  const same = resumeScoutQueue(q, prompt)
  assert.equal(same.units[0].done, true)
  assert.equal(same.candidates.length, 1)
  const changed = resumeScoutQueue(q, prompt + '\n- https://c.org')
  assert.equal(changed.units[0].done, false)
  assert.equal(changed.candidates.length, 0)
  assert.equal(changed.units.length, 4)
})

test('malformed discovery is not interpreted as empty results', () => {
  assert.equal(parseCandidates('No calls today.'), null)
  assert.deepEqual(parseCandidates('Done\n[[CANDIDATES]] {"urls":[]}'), [])
  assert.deepEqual(parseCandidates('[[CANDIDATES]] {"urls":["https://a.org",42]}'), ['https://a.org'])
})
