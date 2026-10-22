import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCOUT_DEFAULT, isSeedPrompt, localizeSeedTask } from './scoutDefault.js'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './local/migrate.js'

test('库里种的中文默认跟 brain 里的一字不差;两份都没有具体来源', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0147_scout_default_without_sources.sql', import.meta.url), 'utf8')
  assert.ok(sql.includes(SCOUT_DEFAULT.zh))
  for (const p of Object.values(SCOUT_DEFAULT)) { assert.ok(p.includes('{{画像}}')); assert.ok(!/https?:\/\//.test(p)); assert.ok(!p.includes('固定聚合源')) }
  assert.ok(isSeedPrompt(SCOUT_DEFAULT.zh) && isSeedPrompt(SCOUT_DEFAULT.en))
  assert.ok(isSeedPrompt('…{{画像}}…\n【一】固定聚合源，扫最新内容… '), '0143 那版老默认也算出厂原样')
  assert.ok(!isSeedPrompt('我自己写的:{{画像}} 只看柏林'), '改过的不算')
})

test('选了英文 → 出厂任务换成英文;改过的不动;切回中文再换回来', async () => {
  const UID = '22222222-2222-4222-8222-222222222222'
  const dir = mkdtempSync(join(tmpdir(), 'fw-seed-'))
  const pg = await openLocalDb(dir); await applyMigrations(pg, { fresh: true }); await setLocalUid(pg, UID); await registerLocalUser(pg, { id: UID, email: 'a@b.c' }); await assumeUser(pg)
  const get = async () => (await pg.query("select prompt from producer.tasks where owner = $1 and type = 'scout_aggregators'", [UID])).rows[0].prompt
  assert.equal(await get(), SCOUT_DEFAULT.zh)
  assert.equal(await localizeSeedTask(pg, UID, 'en'), 1); assert.equal(await get(), SCOUT_DEFAULT.en)
  assert.equal(await localizeSeedTask(pg, UID, 'en'), 0)
  assert.equal(await localizeSeedTask(pg, UID, 'zh'), 1); assert.equal(await get(), SCOUT_DEFAULT.zh)
  await pg.query("update producer.tasks set prompt = $2 where owner = $1 and type = 'scout_aggregators'", [UID, '我改过的 {{画像}}'])
  assert.equal(await localizeSeedTask(pg, UID, 'en'), 0); assert.equal(await get(), '我改过的 {{画像}}')
  await pg.close(); rmSync(dir, { recursive: true, force: true })
})
