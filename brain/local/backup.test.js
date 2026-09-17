import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser } from './migrate.js'
import { backupNow, listBackups, prune, scheduleRestore, openWithRestore, KEEP } from './backup.js'

const UID = '11111111-1111-4111-8111-111111111111'
const tmp = (p) => mkdtempSync(join(tmpdir(), p))

test('备份 → 排恢复 → 重开:数据一样,原来的库改名留着', async () => {
  const data = tmp('fw-bk-'), bdir = tmp('fw-bkdir-')
  let pg = await openLocalDb(data)
  await applyMigrations(pg, { fresh: true }); await setLocalUid(pg, UID); await registerLocalUser(pg, { id: UID, email: 'a@b.c' })
  await pg.query(`select public.pa_set_profile(p_name => $1::text)`, ['备份前'])
  const file = await backupNow(pg, bdir)
  assert.ok(existsSync(file)); assert.equal(listBackups(bdir).length, 1)
  // 备份之后又改了
  await pg.query(`select public.pa_set_profile(p_name => $1::text)`, ['备份后'])
  await pg.close()
  scheduleRestore(data, file)
  const r = await openWithRestore(data)
  assert.equal(r.restored, true); assert.ok(r.kept && existsSync(r.kept), '原来的库改名留着')
  assert.equal(existsSync(join(data, 'restore.tar.gz')), false, '标记用完就删')
  const { rows } = await r.pg.query('select name from producer.profile')
  assert.deepEqual(rows.map((x) => x.name), ['备份前'])
  await r.pg.close()
  rmSync(data, { recursive: true, force: true }); rmSync(bdir, { recursive: true, force: true })
})

test('只留最近 14 份', () => {
  const bdir = tmp('fw-bkdir-')
  for (let i = 1; i <= 17; i++) writeFileSync(join(bdir, `fairwind-2026-09-${String(i).padStart(2, '0')}-080000.tar.gz`), 'x')
  writeFileSync(join(bdir, 'notes.txt'), '别动我')
  const left = prune(bdir)
  assert.equal(left.length, KEEP); assert.equal(left[0].name, 'fairwind-2026-09-17-080000.tar.gz')
  assert.equal(readdirSync(bdir).filter((f) => f.endsWith('.tar.gz')).length, KEEP)
  assert.ok(existsSync(join(bdir, 'notes.txt')), '不是备份的文件不碰')
  rmSync(bdir, { recursive: true, force: true })
})

test('没有标记就照常开;坏文件恢复失败时原库放回去', async () => {
  const data = tmp('fw-bk-')
  const r = await openWithRestore(data); assert.equal(r.restored, false); await r.pg.close()
  writeFileSync(join(data, 'restore.tar.gz'), 'this is not a tarball')
  await assert.rejects(() => openWithRestore(data), /恢复失败/)
  assert.ok(existsSync(join(data, 'db')), '原来的库还在原位')
  assert.ok(existsSync(join(data, 'restore.tar.gz')), '标记留着让人看见')
  rmSync(data, { recursive: true, force: true })
})
