import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './migrate.js'

const A = '10000000-0000-4000-8000-000000000001'
const B = '10000000-0000-4000-8000-000000000002'

async function asUser(pg, uid, fn) {
  await setLocalUid(pg, uid); await assumeUser(pg)
  try { return await fn() } finally { await pg.exec('reset role') }
}

test('scout checkpoint preserves config, pauses and resumes, and cannot update another owner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-scout-checkpoint-'))
  const pg = await openLocalDb(dir)
  try {
    await applyMigrations(pg, { fresh: true })
    await registerLocalUser(pg, { id: A, email: 'a@local.test' })
    await registerLocalUser(pg, { id: B, email: 'b@local.test' })
    const id = (await pg.query("select id from producer.tasks where owner=$1 and type='scout_aggregators'", [A])).rows[0].id
    await asUser(pg, A, async () => {
      await pg.query('update producer.tasks set config=$2::jsonb, running_since=now() where id=$1', [id, JSON.stringify({ card_cap: 7 })])
      await pg.query('select public.pa_scout_checkpoint($1,$2::jsonb,$3,$4)', [id, JSON.stringify({ version: 'v1', completed: 2 }), 'Paused after two', 180])
      const row = (await pg.query('select config,last_result,running_since,next_run_at from producer.tasks where id=$1', [id])).rows[0]
      assert.equal(row.config.card_cap, 7)
      assert.equal(row.config.scout_progress.completed, 2)
      assert.equal(row.last_result, 'Paused after two')
      assert.equal(row.running_since, null)
      assert.ok(new Date(row.next_run_at).getTime() > Date.now())
    })
    await assert.rejects(asUser(pg, B, () => pg.query('select public.pa_scout_checkpoint($1,$2::jsonb)', [id, '{}'])), /scout task not found/)
    await asUser(pg, A, async () => {
      await pg.query('select public.pa_scout_checkpoint($1,$2::jsonb)', [id, null])
      const row = (await pg.query('select config from producer.tasks where id=$1', [id])).rows[0]
      assert.deepEqual(row.config, { card_cap: 7 })
    })
  } finally { await pg.close(); rmSync(dir, { recursive: true, force: true }) }
})
