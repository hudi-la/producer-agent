// brain/local/migrate.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './migrate.js'

const UID = '11111111-1111-4111-8111-111111111111'
const tmp = () => mkdtempSync(join(tmpdir(), 'fairwind-migrate-'))

test('空目录:前言跑通,auth.uid() 跟着 set_config 走', async () => {
  const dir = tmp()
  const pg = await openLocalDb(dir)
  const before = await pg.query('select auth.uid() as uid')
  assert.equal(before.rows[0].uid, null)
  await setLocalUid(pg, UID)
  const after = await pg.query('select auth.uid() as uid')
  assert.equal(after.rows[0].uid, UID)
  await pg.close(); rmSync(dir, { recursive: true, force: true })
})

test('全部迁移在 PGlite 上从零跑绿;第二次跑是 no-op', async () => {
  const dir = tmp()
  const pg = await openLocalDb(dir)
  const r1 = await applyMigrations(pg, { fresh: true })
  assert.ok(r1.applied.length > 100, `只跑了 ${r1.applied.length} 支`)
  const r2 = await applyMigrations(pg, { fresh: true })
  assert.deepEqual(r2.applied, [])
  assert.equal(r2.skipped, r1.applied.length)
  const { rows } = await pg.query(`
    select (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='producer' and c.relkind='r') as tables,
           (select count(*)::int from pg_proc  p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pa\\_%') as fns,
           (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and c.relname like 'v\\_pa\\_%') as views`)
  // 这三个数要跟 db-reset 在 dev 库上报的一致——对不上就是某支迁移在 PGlite 上静默少建了东西
  console.log(`  PGlite 建出来:${rows[0].tables} 张表 · ${rows[0].fns} 个函数 · ${rows[0].views} 个视图`)
  assert.ok(rows[0].tables >= 29 && rows[0].views >= 29)
  await pg.close(); rmSync(dir, { recursive: true, force: true })
})

test('注册本机用户:触发器造出 profile 和 voice 行,owner 盖上 uid', async () => {
  const dir = tmp()
  const pg = await openLocalDb(dir)
  await applyMigrations(pg, { fresh: true })
  await setLocalUid(pg, UID)
  await registerLocalUser(pg, { id: UID, email: 'a@b.c' })
  const p = await pg.query('select owner from producer.profile where owner = $1', [UID])
  const v = await pg.query('select owner from producer.voice where owner = $1', [UID])
  assert.equal(p.rows.length, 1); assert.equal(v.rows.length, 1)
  await pg.close(); rmSync(dir, { recursive: true, force: true })
})

test('切成 authenticated 之后:行级权限生效,只看得见自己的行;注册和迁移仍能回到超级用户做', async () => {
  const dir = tmp()
  const pg = await openLocalDb(dir)
  await applyMigrations(pg, { fresh: true })
  await setLocalUid(pg, UID)
  await registerLocalUser(pg, { id: UID, email: 'a@b.c' })
  await assumeUser(pg)
  assert.equal((await pg.query('select current_user as u')).rows[0].u, 'authenticated')
  // 别人的一行(超级用户身份插的)对我不可见
  const OTHER = '22222222-2222-4222-8222-222222222222'
  await registerLocalUser(pg, { id: OTHER, email: 'b@b.c' })      // 内部 reset role → 插 → set role 回来
  assert.equal((await pg.query('select current_user as u')).rows[0].u, 'authenticated')
  const mine = await pg.query('select * from public.v_pa_profile')      // 视图不露 owner;两个人各一行,RLS 之下只见一行
  assert.equal(mine.rows.length, 1)
  const raw = await pg.query('select owner from producer.profile')       // 直读表也一样被门管着
  assert.deepEqual(raw.rows.map((r) => r.owner), [UID])
  // 迁移是 no-op 但要能在 authenticated 状态下调(它自己回超级用户)
  const r = await applyMigrations(pg, { fresh: true })
  assert.deepEqual(r.applied, [])
  assert.equal((await pg.query('select current_user as u')).rows[0].u, 'authenticated')
  await pg.close(); rmSync(dir, { recursive: true, force: true })
})
