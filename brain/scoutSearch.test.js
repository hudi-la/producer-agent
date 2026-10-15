import test from 'node:test'
import assert from 'node:assert/strict'
import { scoutSearch } from './scoutSearch.js'

const ctx = { today: '2026-10-08', tz: 'America/Los_Angeles', profile: null, concerns: [], works: [] }
const report = () => ({ checked: [], opened: [], closedNow: [], leftToCheck: 0,
  found: [], dupFound: [], skipped: [] })
const card = (url, title) => `[[CARDS]] ${JSON.stringify({ cards: [{ title, url, status: 'open', match_stars: 3, eligible: true }], skipped: [] })}`

function harness(prompt, { failWriteOnce = false } = {}) {
  const task = { id: 'task-1', type: 'scout_aggregators', prompt, enabled: true, config: {} }
  const rows = []
  const calls = []
  let fail = failWriteOnce
  const db = { rpc: async (name, args) => {
    if (name === 'pa_scout_checkpoint') {
      if (args.p_progress === null) delete task.config.scout_progress
      else task.config.scout_progress = structuredClone(args.p_progress)
      if (args.p_result) task.last_result = args.p_result
      if (args.p_delay_minutes != null) task.next_run_at = new Date(Date.now() + args.p_delay_minutes * 60_000).toISOString()
      return { error: null }
    }
    assert.equal(name, 'pa_upsert_opportunity')
    if (fail) { fail = false; return { error: { message: 'temporary write failure' } } }
    if (rows.some((x) => x.url === args.p_url || x.title === args.p_title)) return { data: { created: false } }
    rows.push({ title: args.p_title, url: args.p_url })
    return { data: { created: true } }
  } }
  const think = async (promptText) => {
    calls.push(promptText.startsWith('Discover') ? 'discover' : 'verify')
    if (promptText.startsWith('Discover')) {
      const source = promptText.match(/Only work on (.*?) in this call/)?.[1] || ''
      const url = source.includes('a.org/calls') ? 'https://official.org/a' : 'https://official.org/b'
      return { text: `[[CANDIDATES]] ${JSON.stringify({ urls: [url] })}` }
    }
    const url = promptText.includes('official.org/a') ? 'https://official.org/a' : 'https://official.org/b'
    return { text: card(url, url.endsWith('/a') ? 'A Call' : 'B Call') }
  }
  const deps = { db, think, readTools: [], systemFor: () => 'test system' }
  const run = async (budget) => scoutSearch(task, ctx, null, report(), rows.map((x) => ({ ...x })), budget, deps)
  return { task, rows, calls, run }
}

test('budget pause is durable across restarts; completed sources and candidates are not refetched', async () => {
  const h = harness('- https://a.org/calls\n- "open call" installation art 2027')
  const a = await h.run(1)
  assert.equal(a.paused, true)
  assert.equal(h.task.config.scout_progress.units[0].done, true)
  assert.deepEqual(h.calls, ['discover'])
  const b = await h.run(1)
  assert.equal(b.paused, true)
  assert.deepEqual(h.calls, ['discover', 'discover'])
  const c = await h.run(1)
  assert.equal(c.paused, true)
  assert.deepEqual(h.rows.map((x) => x.title), ['A Call'])
  assert.equal(h.task.config.scout_progress.candidates[0].done, true)
  const d = await h.run(1)
  assert.equal(d.paused, false)
  assert.equal(d.added, 2)
  assert.deepEqual(h.rows.map((x) => x.title), ['A Call', 'B Call'])
  assert.deepEqual(h.calls, ['discover', 'discover', 'verify', 'verify'])
  const again = await h.run(1)
  assert.equal(again.paused, false)
  assert.deepEqual(h.calls, ['discover', 'discover', 'verify', 'verify'])
  assert.equal(h.rows.length, 2)
})

test('verified result survives a database write failure and resumes without another model call', async () => {
  const h = harness('- https://a.org/calls', { failWriteOnce: true })
  const a = await h.run(2)
  assert.equal(a.paused, true)
  assert.equal(h.task.config.scout_progress.candidates[0].done, false)
  assert.equal(h.task.config.scout_progress.candidates[0].result.cards[0].title, 'A Call')
  assert.deepEqual(h.calls, ['discover', 'verify'])
  const b = await h.run(0)
  assert.equal(b.paused, false)
  assert.deepEqual(h.rows.map((x) => x.title), ['A Call'])
  assert.deepEqual(h.calls, ['discover', 'verify'])
})

test('editing the prompt rebuilds unfinished work while existing pool results stay deduplicated', async () => {
  const h = harness('- https://a.org/calls')
  await h.run(2)
  assert.equal(h.rows.length, 1)
  h.task.prompt = '- https://a.org/calls\n- "open call" installation art 2027'
  const reset = await h.run(1)
  assert.equal(reset.paused, true)
  assert.equal(h.task.config.scout_progress.units.length, 2)
  assert.equal(h.task.config.scout_progress.units[0].done, true)
  assert.equal(h.rows.length, 1)
})
