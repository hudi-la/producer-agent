// brain/local/localdb.test.js
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './migrate.js'
import { makeLocalDb } from './localdb.js'

const UID = '11111111-1111-4111-8111-111111111111'
let dir, pg, db
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fairwind-localdb-'))
  pg = await openLocalDb(dir)
  await applyMigrations(pg, { fresh: true })
  await setLocalUid(pg, UID)
  await registerLocalUser(pg, { id: UID, email: 'a@b.c' })
  // 六个夹具函数,专门测返回值整形(跟 PostgREST 同规矩)
  await pg.exec(`
    create function public.pa_t_scalar(p_x int) returns int language sql as $$ select p_x * 2 $$;
    create function public.pa_t_setof(p_n int) returns setof int language sql as $$ select generate_series(1, p_n) $$;
    create function public.pa_t_table(p_s text) returns table (a text, b int) language sql as $$ select p_s, 1 union all select p_s, 2 $$;
    create function public.pa_t_json(p_s text) returns jsonb language sql as $$ select jsonb_build_object('s', p_s) $$;
    create function public.pa_t_void(p_s text) returns void language sql as $$ select 1 $$;
    create function public.pa_t_dflt(p_a int, p_b int default 10) returns int language sql as $$ select p_a + p_b $$;
  `)
  await assumeUser(pg)   // 跟真跑一样:以 authenticated 身份,行级权限生效
  db = await makeLocalDb({ pg, dataDir: dir, user: { id: UID, email: 'a@b.c' } })
})
after(async () => { await pg.close(); rmSync(dir, { recursive: true, force: true }) })

test('rpc:标量 / setof 标量 / table / json / void / 默认参数', async () => {
  assert.deepEqual(await db.rpc('pa_t_scalar', { p_x: 3 }), { data: 6, error: null })
  assert.deepEqual((await db.rpc('pa_t_setof', { p_n: 3 })).data, [1, 2, 3])
  assert.deepEqual((await db.rpc('pa_t_table', { p_s: 'x' })).data, [{ a: 'x', b: 1 }, { a: 'x', b: 2 }])
  assert.deepEqual((await db.rpc('pa_t_json', { p_s: 'x' })).data, { s: 'x' })
  assert.deepEqual(await db.rpc('pa_t_void', { p_s: 'x' }), { data: null, error: null })
  assert.equal((await db.rpc('pa_t_dflt', { p_a: 1 })).data, 11)
})

test('rpc:不存在的函数 / SQL 错误 → error,不抛', async () => {
  const r = await db.rpc('pa_nope', {})
  assert.equal(r.data, null); assert.match(r.error.message, /pa_nope/)
})

test('rpc:真函数——pa_set_profile 写、v_pa_profile 读', async () => {
  const w = await db.rpc('pa_set_profile', { p_name: '测试' })
  assert.equal(w.error, null, w.error?.message)
  const { data, error } = await db.from('v_pa_profile').select('*').maybeSingle()
  assert.equal(error, null); assert.equal(data.name, '测试')
})

test('from:select/eq/in/order/limit 拼成一条 select', async () => {
  const q = db.from('v_pa_entries').select('id, title').eq('kind', 'work').in('id', [UID, '22222222-2222-4222-8222-222222222222']).order('title', { ascending: false }).limit(5)
  assert.equal(q.toSQL().text, 'select id, title from public.v_pa_entries where kind = $1 and id = any($2) order by title desc limit 5')
  assert.deepEqual(q.toSQL().values, ['work', [UID, '22222222-2222-4222-8222-222222222222']])
  const { data, error } = await q
  assert.equal(error, null); assert.deepEqual(data, [])
})

test('from:列名只许字母数字下划线逗号空格', async () => {
  const r = await db.from('v_pa_profile').select('*; drop table x')
  assert.match(r.error.message, /列名/)
})

test('storage:upload → download → createSignedUrl → remove', async () => {
  const s = db.storage.from('pursuit-files')
  const up = await s.upload('p1/hello.txt', Buffer.from('hi'), { contentType: 'text/plain' })
  assert.equal(up.error, null)
  const dl = await s.download('p1/hello.txt')
  assert.equal(Buffer.from(await dl.data.arrayBuffer()).toString(), 'hi')
  const url = await s.createSignedUrl('p1/hello.txt', 60)
  assert.equal(url.data.signedUrl, 'http://localhost:8788/files/p1%2Fhello.txt')
  await s.remove(['p1/hello.txt'])
  assert.notEqual((await s.download('p1/hello.txt')).error, null)
})

test('storage:key 不许跳出 files 目录', async () => {
  const r = await db.storage.from('pursuit-files').upload('../../etc/x', Buffer.from(''))
  assert.match(r.error.message, /key/)
})

test('auth.getUser 返回本机那个人', async () => {
  assert.deepEqual(await db.auth.getUser(), { data: { user: { id: UID, email: 'a@b.c' } }, error: null })
})
