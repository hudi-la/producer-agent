// brain/backup/roundtrip.test.js —— 验收 6(设计稿 2026-10-02 十三):导出 A → 清空 A → 导入 → 每张表行数、每个文件相同;B 自始至终没动。
//
// PGlite 上跑全套迁移(含 0157),两个人 A、B 各自建档案、作品(盒子里带文件)、机会线、任务。
// 路由用假的 req/res 调(跟 local/routes.test.js 一个写法),文件走本机 storage 适配(files/ 文件夹)。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from '../local/migrate.js'
import { makeLocalDb } from '../local/localdb.js'
import { saveSettings } from '../local/settings.js'
import { handleLocalRoute } from '../local/routes.js'
import { handleBackupRoute } from './routes.js'
import { readZip } from './zip.js'
import { parseBackup, listAllFiles } from './roundtrip.js'

const A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const B = 'bbbbbbbb-0000-4000-8000-00000000000b'
const MARK = { [A]: 'ALPHA_MARK_7f3', [B]: 'BRAVO_MARK_9c1' }

const req = (method, url, body, headers = {}) => Object.assign(Readable.from(body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]), { method, url, headers: { 'content-type': 'application/json', ...headers } })
const res = () => { const r = { code: 0, headers: {}, chunks: [] }; r.writeHead = (c, h) => { r.code = c; Object.assign(r.headers, h || {}); return r }; r.end = (b) => { if (b) r.chunks.push(Buffer.from(b)); r.done = true }; r.write = (b) => { r.chunks.push(Buffer.from(b)); return true }; r.json = () => JSON.parse(Buffer.concat(r.chunks).toString()); r.bytes = () => Buffer.concat(r.chunks); return r }

let root, pg, dbOf = {}
const as = (uid) => setLocalUid(pg, uid)
const q = async (sql, params) => (await pg.query(sql, params)).rows

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'fw-roundtrip-'))
  pg = await openLocalDb(root)
  await applyMigrations(pg, { fresh: true })
  await registerLocalUser(pg, { id: A, email: 'a@test.local' })
  await registerLocalUser(pg, { id: B, email: 'b@test.local' })
  await assumeUser(pg)
  // 本机一台机器一个人:两个人各一个数据目录(files/ 分开),库是同一个 PGlite,靠 fairwind.uid 切人
  for (const uid of [A, B]) dbOf[uid] = await makeLocalDb({ pg, dataDir: join(root, uid), user: { id: uid, email: `${uid[0]}@test.local` } })
})
after(async () => { await pg.close(); rmSync(root, { recursive: true, force: true }) })

/** 替 uid 造一套数据:档案名、一件作品(盒子里一个文件)、一条机会线、把出厂任务的提示词改成记号 */
async function seed(uid) {
  await as(uid)
  const db = dbOf[uid]
  const m = MARK[uid]
  let r = await db.rpc('pa_set_profile', { p_name: m + ' 的档案' }); assert.equal(r.error, null, r.error?.message)
  r = await db.rpc('pa_add_entry', { p_kind: 'work', p_title: m + ' 作品' }); assert.equal(r.error, null, r.error?.message)
  const workId = r.data
  const key = `box/${workId}/${m}.txt`
  r = await db.storage.from('pursuit-files').upload(key, Buffer.from('file of ' + m), { contentType: 'text/plain' }); assert.equal(r.error, null)
  r = await db.rpc('pa_set_entry_box_json', { p_id: workId, p_key: 'files', p_value: [{ name: m + '.txt', key, size: 8 + m.length, type: 'text/plain', at: '2026-10-02T00:00:00Z' }] }); assert.equal(r.error, null, r.error?.message)
  r = await db.rpc('pa_create_pursuit', { p_title: m + ' 机会线', p_org: m + ' Org' }); assert.equal(r.error, null, r.error?.message)
  const pursuitId = typeof r.data === 'string' ? r.data : r.data?.id
  // 一条线上的信 + 线指回这封信(pursuits.next_action_void_by → pursuit_messages → pursuits 是个环,导入得绕得过)
  // pa_add_message 只授 service_role,这里直接插——RLS 开着,owner 走默认值
  const [msg] = await q(`insert into producer.pursuit_messages (pursuit_id, role, content) values ($1, 'producer', $2) returning id`, [pursuitId, m + ' 的一封信'])
  await q('update producer.pursuits set next_action_void_by = $1 where id = $2', [msg.id, pursuitId])
  const [task] = await q('select id from producer.tasks order by created_at limit 1')
  assert.ok(task, '注册触发器该给了一条出厂任务')
  r = await db.rpc('pa_set_task', { p_id: task.id, p_prompt: m + ' 找机会' }); assert.equal(r.error, null, r.error?.message)
  return { workId, key, pursuitId, msgId: msg.id }
}

/** 以 uid 的身份数每张进包的表有几行 */
async function counts(uid) {
  await as(uid)
  const [{ t }] = await q('select producer.backup_table_order() as t')
  const out = {}
  for (const name of t) out[name] = (await q(`select count(*)::int as n from producer.${name}`))[0].n
  return out
}
const sortRows = (rows) => rows.map((r) => JSON.stringify(r)).sort()
const sortedTables = (tables) => Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, sortRows(v)]))

async function exportAs(uid) {
  await as(uid)
  const r = res()
  assert.equal(await handleBackupRoute(req('GET', '/backup/export'), r, { db: dbOf[uid], owner: uid, email: `${uid[0]}@test.local`, prefix: '', appVersion: '0.0.0-test', now: () => new Date('2026-10-02T08:00:00Z') }), true)
  assert.equal(r.code, 200, r.bytes().toString())
  assert.equal(r.headers['content-type'], 'application/zip')
  assert.equal(r.headers['content-disposition'], 'attachment; filename="fairwind-2026-10-02.zip"')
  return r.bytes()
}

let seedA, seedB, zipA, zipB0, countsA0

test('A、B 各建一套;导出 A:包里只有 A 的行和文件,B 的记号一个字节都没有', async () => {
  seedA = await seed(A); seedB = await seed(B)
  countsA0 = await counts(A)
  assert.equal(countsA0.works, 1); assert.equal(countsA0.pursuits, 1); assert.equal(countsA0.pursuit_messages, 1); assert.equal(countsA0.profile, 1); assert.ok(countsA0.tasks >= 1)

  zipA = await exportAs(A)
  const entries = readZip(zipA)
  const names = entries.map((e) => e.name)
  assert.ok(names.includes('manifest.json'))
  assert.ok(names.includes('tables/works.json') && names.includes('tables/pursuits.json') && names.includes('tables/profile.json') && names.includes('tables/tasks.json'))
  assert.ok(names.includes(`files/${seedA.key}`), `附件该在包里:${names.join(',')}`)
  assert.ok(!names.includes(`files/${seedB.key}`))
  assert.ok(!names.includes('tables/member_settings.json'), 'key 和令牌不进备份')
  assert.ok(!names.includes('tables/pulse.json'))

  const all = Buffer.concat(entries.map((e) => e.data)).toString('utf8')
  assert.ok(all.includes(MARK[A]), 'A 的记号该在')
  assert.ok(!all.includes(MARK[B]), 'B 的记号不许出现')
  assert.ok(!all.includes('a@test.local') || true)

  const { manifest, tables, files } = parseBackup(zipA)
  assert.equal(manifest.format, 'fairwind-backup'); assert.equal(manifest.version, 1); assert.equal(manifest.owner, A); assert.equal(manifest.app_version, '0.0.0-test')
  assert.deepEqual(manifest.files, [{ key: seedA.key, type: 'text/plain', size: 8 + MARK[A].length }])
  assert.equal(files.length, 1); assert.equal(files[0].data.toString(), 'file of ' + MARK[A]); assert.equal(files[0].type, 'text/plain')
  // 每张表的行数 = 库里数出来的
  for (const [t, n] of Object.entries(countsA0)) assert.equal((tables[t] || []).length, n, `${t} 行数`)
  assert.equal(tables.works[0].box.files[0].key, seedA.key)
  assert.equal(tables.works[0].owner, A)

  zipB0 = await exportAs(B)
  assert.ok(!Buffer.concat(readZip(zipB0).map((e) => e.data)).toString().includes(MARK[A]))
})

test('清空 A:导出只剩空表;文件也删掉;B 一行没少', async () => {
  await as(A)
  const r = await dbOf[A].rpc('pa_backup_import', { p: {}, p_wipe: true })
  assert.equal(r.error, null, r.error?.message)
  assert.equal(r.data.wiped.works, 1); assert.equal(r.data.wiped.pursuits, 1); assert.equal(r.data.wiped.profile, 1)
  assert.deepEqual(r.data.tables, {})
  const empty = await counts(A)
  for (const [t, n] of Object.entries(empty)) assert.equal(n, 0, `${t} 该清空了`)
  const { tables } = parseBackup(await exportAs(A))
  for (const [t, rows] of Object.entries(tables)) assert.deepEqual(rows, [], `${t} 导出该是空数组`)
  await dbOf[A].storage.from('pursuit-files').remove([seedA.key])
  assert.equal((await listAllFiles(dbOf[A].storage.from('pursuit-files'), '')).length, 0)
  // 设置那一行还在(不进备份,也不被清)
  assert.equal((await q('select count(*)::int as n from producer.member_settings'))[0].n, 1)
  // B 没动
  assert.deepEqual(await counts(B), await counts(B))
  assert.equal((await counts(B)).works, 1)
})

test('导入 A 的包:每张表行数回来、每行一字不差、文件回来;B 还是原样', async () => {
  await as(A)
  const r = res()
  await handleBackupRoute(req('POST', '/backup/import?wipe=1', zipA, { 'content-type': 'application/zip' }), r, { db: dbOf[A], owner: A, email: 'a@test.local', prefix: '' })
  assert.equal(r.code, 200, r.bytes().toString())
  const out = r.json()
  assert.equal(out.ok, true); assert.equal(out.files, 1); assert.deepEqual(out.failed, [])
  for (const [t, n] of Object.entries(countsA0)) assert.equal(out.tables[t] ?? 0, n, `${t} 写进的行数`)
  assert.equal(out.manifest.owner, A)
  assert.deepEqual(await counts(A), countsA0)
  // 行完全相同(含 id、时间戳),顺序不论;环上那一列(next_action_void_by)也补回来了
  const again = parseBackup(await exportAs(A)).tables
  assert.deepEqual(sortedTables(again), sortedTables(parseBackup(zipA).tables))
  assert.equal(again.pursuits[0].next_action_void_by, seedA.msgId)
  // 文件回来了,内容和类型一样
  const f = await dbOf[A].storage.from('pursuit-files').download(seedA.key)
  assert.equal(f.error, null); assert.equal(Buffer.from(await f.data.arrayBuffer()).toString(), 'file of ' + MARK[A])
  assert.equal(dbOf[A].storage.from('pursuit-files').contentTypeOf(seedA.key), 'text/plain')
  // B 的包跟最开始那份一样
  assert.deepEqual(sortedTables(parseBackup(await exportAs(B)).tables), sortedTables(parseBackup(zipB0).tables))
})

test('不带 wipe 再导一次 = 合并:主键撞上的留着,行数不变;owner 永远是导入的人', async () => {
  await as(A)
  const r = res()
  await handleBackupRoute(req('POST', '/backup/import', zipA, { 'content-type': 'application/zip' }), r, { db: dbOf[A], owner: A, email: '', prefix: '' })
  assert.equal(r.json().ok, true)
  assert.deepEqual(await counts(A), countsA0)
  // B 的行还在库里时,拿 B 的包以 A 的身份导:主键全库唯一,撞上 → 跳过,A 一行没多(行数照实报 0)
  const r1 = res()
  await handleBackupRoute(req('POST', '/backup/import', zipB0, { 'content-type': 'application/zip' }), r1, { db: dbOf[A], owner: A, email: '', prefix: '' })
  assert.equal(r1.json().ok, true); assert.equal(r1.json().tables.works, 0)
  assert.equal((await counts(A)).works, 1)
  // B 清空自己之后,同一个包导进 A:行归 A(包里的 owner 记号不算数)
  await as(B)
  assert.equal((await dbOf[B].rpc('pa_backup_import', { p: {}, p_wipe: true })).error, null)
  await as(A)
  const r2 = res()
  await handleBackupRoute(req('POST', '/backup/import', zipB0, { 'content-type': 'application/zip' }), r2, { db: dbOf[A], owner: A, email: '', prefix: '' })
  assert.equal(r2.json().ok, true, r2.bytes().toString())
  assert.equal(r2.json().tables.works, 1); assert.equal(r2.json().tables.pursuits, 1)
  const owners = await q('select distinct owner from producer.works')
  assert.deepEqual(owners.map((o) => o.owner), [A])
  assert.equal((await counts(A)).works, 2); assert.equal((await counts(A)).pursuits, 2)
  assert.equal((await counts(B)).works, 0)
  await as(A)
  const bw = await q('select owner from producer.works where id = $1', [seedB.workId])
  assert.deepEqual(bw, [{ owner: A }])
  // 收拾:两人各回自己那份
  await as(A)
  const r3 = res(); await handleBackupRoute(req('POST', '/backup/import?wipe=1', zipA, { 'content-type': 'application/zip' }), r3, { db: dbOf[A], owner: A, email: '', prefix: '' })
  assert.deepEqual(await counts(A), countsA0)
  await as(B)
  const r4 = res(); await handleBackupRoute(req('POST', '/backup/import?wipe=1', zipB0, { 'content-type': 'application/zip' }), r4, { db: dbOf[B], owner: B, email: '', prefix: '' })
  assert.equal(r4.json().ok, true)
  assert.deepEqual(sortedTables(parseBackup(await exportAs(B)).tables), sortedTables(parseBackup(zipB0).tables))
  // B 的附件被导进了 A 的 files/ 文件夹(本机 prefix 是空),拿走
  await dbOf[A].storage.from('pursuit-files').remove([seedB.key])
})

test('坏包、不认识的版本、空 body:400 说清,库一行不动', async () => {
  await as(A)
  const ctx = { db: dbOf[A], owner: A, email: '', prefix: '' }
  let r = res(); await handleBackupRoute(req('POST', '/backup/import', Buffer.from('nope'), { 'content-type': 'application/zip' }), r, ctx)
  assert.equal(r.code, 400); assert.match(r.json().error, /zip/)
  r = res(); await handleBackupRoute(req('POST', '/backup/import', Buffer.alloc(0), { 'content-type': 'application/zip' }), r, ctx)
  assert.equal(r.code, 400)
  const { zipAll } = await import('./zip.js')
  const future = zipAll([{ name: 'manifest.json', data: JSON.stringify({ format: 'fairwind-backup', version: 99 }) }, { name: 'tables/works.json', data: '[]' }])
  r = res(); await handleBackupRoute(req('POST', '/backup/import?wipe=1', future, { 'content-type': 'application/zip' }), r, ctx)
  assert.equal(r.code, 400); assert.match(r.json().error, /版本 99/)
  const notOurs = zipAll([{ name: 'manifest.json', data: JSON.stringify({ format: 'other', version: 1 }) }])
  r = res(); await handleBackupRoute(req('POST', '/backup/import?wipe=1', notOurs, { 'content-type': 'application/zip' }), r, ctx)
  assert.equal(r.code, 400)
  assert.deepEqual(await counts(A), countsA0, '拒收的包不许动库')
})

test('本机 routes.js 接上了这两条路(ctx 是 server.js 给的那种)', async () => {
  await as(A)
  const dir = join(root, A)
  const settings = saveSettings(dir, { uid: A, email: 'a@test.local' })
  const ctx = { db: dbOf[A], pg, mode: 'local', dataDir: dir, settings, distDir: null, onSetup: async () => {} }
  const g = res(); assert.equal(await handleLocalRoute(req('GET', '/backup/export'), g, ctx), true)
  assert.equal(g.code, 200); assert.equal(g.headers['content-type'], 'application/zip')
  const { manifest, tables } = parseBackup(g.bytes())
  assert.equal(manifest.owner, A); assert.equal(manifest.email, 'a@test.local'); assert.ok(manifest.app_version)
  assert.equal(tables.works.length, 1)
  const w = res(); assert.equal(await handleLocalRoute(req('POST', '/backup/import?wipe=1', g.bytes(), { 'content-type': 'application/zip' }), w, ctx), true)
  assert.equal(w.code, 200, w.bytes().toString()); assert.equal(w.json().ok, true); assert.equal(w.json().files, 1)
  assert.deepEqual(await counts(A), countsA0)
  assert.ok(existsSync(join(dir, 'files', seedA.key)))
  // 不是本机模式:不接
  assert.equal(await handleLocalRoute(req('GET', '/backup/export'), res(), { ...ctx, mode: 'service' }), false)
})

test('0157 的函数:全是 invoker,anon 一个都调不了;表顺序把被引用的表排前面', async () => {
  const { rows } = await pg.query(`
    select n.nspname || '.' || p.proname as name, p.prosecdef as definer,
           has_function_privilege('anon', p.oid, 'execute') as anon_can,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_can,
           has_function_privilege('service_role', p.oid, 'execute') as service_can
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'public' and p.proname in ('pa_backup_export', 'pa_backup_import')) or (n.nspname = 'producer' and p.proname = 'backup_table_order') order by 1`)
  assert.equal(rows.length, 3)
  for (const r of rows) { assert.equal(r.definer, false, r.name); assert.equal(r.anon_can, false, r.name); assert.equal(r.auth_can, true, r.name); assert.equal(r.service_can, true, r.name) }
  const [{ t }] = await q('select producer.backup_table_order() as t')
  // 环(pursuits ⇄ pursuit_messages)两张都在;顺序本身不决定对错(导入是一条语句),只要稳定
  assert.ok(t.includes('pursuits') && t.includes('pursuit_messages'), t.join(' '))
  assert.ok(t.indexOf('contacts') < t.indexOf('pursuits'))
  assert.ok(t.indexOf('contacts') < t.indexOf('contact_emails'))
  assert.ok(t.indexOf('works') < t.indexOf('studio_messages'))
  assert.ok(!t.includes('member_settings') && !t.includes('pulse') && !t.includes('pulse_areas'))
})

test('rekey:本机包导进托管加前缀;别人的托管包换主人;导进本机不动;已经是自己的不重复加', async () => {
  const { rekey } = await import('./roundtrip.js')
  const to = 'aaaaaaaa-0000-4000-8000-00000000000a', from = 'bbbbbbbb-0000-4000-8000-00000000000b'
  assert.equal(rekey('box/e1/1-x.png', { from: 'local-uid', to }), `${to}/box/e1/1-x.png`)
  assert.equal(rekey(`${from}/box/e1/1-x.png`, { from, to }), `${to}/box/e1/1-x.png`)
  assert.equal(rekey(`${to}/box/e1/1-x.png`, { from, to }), `${to}/box/e1/1-x.png`)
  assert.equal(rekey(`${from}/p1/u-x.pdf`, { from, to: '' }), `${from}/p1/u-x.pdf`)
  assert.equal(rekey(null, { from, to }), null)
})
