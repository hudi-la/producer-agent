// brain/backup/hosted.test.js —— 托管那几条路,拿假的 t.db 验(没有真 Supabase):
// 导出走 rpc + storage.list(递归)/download,导入走 rpc + storage.upload,换令牌走 rpc + invalidate。
// 表和 zip 的真功夫在 roundtrip.test.js(PGlite)里验过了;这里只管托管路由把身份和桶前缀接对。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { withTenant } from '../tenant.js'
import { handleHostedRoute } from '../hosted/routes.js'
import { parseBackup } from './roundtrip.js'
import { zipAll } from './zip.js'

const OWNER = 'cccccccc-0000-4000-8000-00000000000c'
const req = (method, url, body, headers = {}) => Object.assign(Readable.from(body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]), { method, url, headers: { 'content-type': 'application/json', ...headers } })
const res = () => { const r = { code: 0, headers: {}, chunks: [] }; r.writeHead = (c, h) => { r.code = c; Object.assign(r.headers, h || {}); return r }; r.end = (b) => { if (b) r.chunks.push(Buffer.from(b)); r.done = true }; r.write = (b) => { r.chunks.push(Buffer.from(b)); return true }; r.json = () => JSON.parse(Buffer.concat(r.chunks).toString()); r.bytes = () => Buffer.concat(r.chunks); return r }

/** 假的 supabase-js:桶里 <owner>/ 底下两层文件;rpc 记下调用 */
function fakeDb() {
  const calls = []
  const objects = new Map([[`${OWNER}/box/w1/a.txt`, { bytes: Buffer.from('aaa'), type: 'text/plain' }], [`${OWNER}/p1/deep/b.pdf`, { bytes: Buffer.from('%PDF'), type: 'application/pdf' }]])
  const uploads = []
  const db = {
    async rpc(name, args) {
      calls.push([name, args])
      if (name === 'pa_backup_export') return { data: { profile: [{ id: 'p', name: 'C', owner: OWNER }], works: [{ id: 'w1', title: 'W', owner: OWNER }] }, error: null }
      if (name === 'pa_backup_import') return { data: { tables: { profile: 1, works: 1 }, wiped: args.p_wipe ? { profile: 1, works: 1 } : {} }, error: null }
      if (name === 'pa_rotate_mcp_token') return { data: 'f'.repeat(48), error: null }
      return { data: null, error: { message: '没有这个函数:' + name } }
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'pursuit-files')
      return {
        async list(prefix, { limit, offset }) {
          calls.push(['list', prefix, limit, offset])
          if (offset > 0) return { data: [], error: null }
          const seen = new Map()
          for (const key of objects.keys()) {
            if (!key.startsWith(prefix + '/')) continue
            const rest = key.slice(prefix.length + 1); const [head, ...more] = rest.split('/')
            if (more.length) seen.set(head, { name: head, id: null, metadata: null })
            else seen.set(head, { name: head, id: key, metadata: { size: objects.get(key).bytes.length, mimetype: objects.get(key).type } })
          }
          return { data: [...seen.values()], error: null }
        },
        async download(key) { const o = objects.get(key); return o ? { data: new Blob([o.bytes]), error: null } : { data: null, error: { message: 'Object not found' } } },
        async upload(key, bytes, opts) {
          uploads.push({ key, bytes, opts })
          if (!key.startsWith(OWNER + '/')) return { data: null, error: { message: 'new row violates row-level security policy' } }
          return { data: { path: key }, error: null }
        },
      }
    } },
  }
  return { db, calls, uploads }
}

const tenantOf = (db) => ({ mode: 'hosted', owner: OWNER, email: 'c@test.local', db, settings: { provider: 'claude-key', apiKey: 'sk-ant-x', mcpToken: 'old' }, env: {}, modules: {}, judgments: { docs: {} }, marks: {} })

test('GET /backup/export:以租户身份读表、只列 owner/ 底下的附件(递归),包里 manifest 写着我', async () => {
  const { db, calls } = fakeDb()
  const invalidated = []
  const r = res()
  const handled = await withTenant(tenantOf(db), () => handleHostedRoute(req('GET', '/backup/export'), r, { hosted: { invalidate: (o) => invalidated.push(o) }, distDir: null }))
  assert.equal(handled, true)
  assert.equal(r.code, 200, r.bytes().toString())
  assert.equal(r.headers['content-type'], 'application/zip'); assert.match(r.headers['content-disposition'], /^attachment; filename="fairwind-\d{4}-\d{2}-\d{2}\.zip"$/)
  const { manifest, tables, files } = parseBackup(r.bytes())
  assert.equal(manifest.owner, OWNER); assert.equal(manifest.email, 'c@test.local'); assert.ok(manifest.app_version)
  assert.deepEqual(manifest.tables, ['profile', 'works'])
  assert.deepEqual(tables.works, [{ id: 'w1', title: 'W', owner: OWNER }])
  assert.deepEqual(files.map((f) => [f.key, f.data.toString(), f.type]).sort(), [[`${OWNER}/box/w1/a.txt`, 'aaa', 'text/plain'], [`${OWNER}/p1/deep/b.pdf`, '%PDF', 'application/pdf']])
  // 列的是 owner 这一段,不是整个桶
  assert.equal(calls.find((c) => c[0] === 'list')[1], OWNER)
  assert.ok(calls.some((c) => c[0] === 'pa_backup_export'))
})

test('POST /backup/import?wipe=1:rpc 带 p_wipe、文件传回桶;没带 owner 前缀的 key(本机包)换成我的前缀再传', async () => {
  const { db, calls, uploads } = fakeDb()
  const zip = zipAll([
    { name: 'manifest.json', data: JSON.stringify({ format: 'fairwind-backup', version: 1, owner: OWNER, files: [{ key: `${OWNER}/box/w1/a.txt`, type: 'text/plain' }, { key: 'box/w9/stray.txt', type: 'text/plain' }] }), deflate: true },
    { name: 'tables/profile.json', data: '[{"id":"p","name":"C"}]', deflate: true },
    { name: 'tables/works.json', data: '[{"id":"w1","title":"W"}]', deflate: true },
    { name: `files/${OWNER}/box/w1/a.txt`, data: 'aaa' },
    { name: 'files/box/w9/stray.txt', data: 'stray' },
  ])
  const r = res()
  await withTenant(tenantOf(db), () => handleHostedRoute(req('POST', '/backup/import?wipe=1', zip, { 'content-type': 'application/zip' }), r, { hosted: { invalidate() {} }, distDir: null }))
  assert.equal(r.code, 200, r.bytes().toString())
  const out = r.json()
  assert.equal(out.ok, true); assert.deepEqual(out.tables, { profile: 1, works: 1 }); assert.deepEqual(out.wiped, { profile: 1, works: 1 })
  assert.equal(out.files, 2); assert.deepEqual(out.failed, [])
  assert.deepEqual(uploads.map((u) => u.key), [`${OWNER}/box/w1/a.txt`, `${OWNER}/box/w9/stray.txt`])   // 本机包的 key 加上了我的前缀
  const imp = calls.find((c) => c[0] === 'pa_backup_import')
  assert.equal(imp[1].p_wipe, true); assert.deepEqual(imp[1].p, { profile: [{ id: 'p', name: 'C' }], works: [{ id: 'w1', title: 'W' }] })
  assert.equal(uploads[0].key, `${OWNER}/box/w1/a.txt`); assert.equal(uploads[0].opts.contentType, 'text/plain'); assert.equal(uploads[0].opts.upsert, true)
})

test('POST /settings/mcp-token/rotate:换一串、让工厂重读、回新令牌', async () => {
  const { db, calls } = fakeDb()
  const invalidated = []
  const t = tenantOf(db)
  const r = res()
  await withTenant(t, () => handleHostedRoute(req('POST', '/settings/mcp-token/rotate', {}), r, { hosted: { invalidate: (o) => invalidated.push(o) }, distDir: null }))
  assert.equal(r.code, 200)
  assert.deepEqual(r.json(), { ok: true, mcpToken: 'f'.repeat(48) })
  assert.deepEqual(invalidated, [OWNER])
  assert.equal(t.settings.mcpToken, 'f'.repeat(48))
  assert.ok(calls.some((c) => c[0] === 'pa_rotate_mcp_token'))
})

test('没带身份:三条路都是 401,不碰库', async () => {
  const { db, calls } = fakeDb()
  for (const [m, u] of [['GET', '/backup/export'], ['POST', '/backup/import'], ['POST', '/settings/mcp-token/rotate']]) {
    const r = res()
    assert.equal(await handleHostedRoute(req(m, u, m === 'POST' ? {} : null), r, { hosted: { invalidate() {} }, distDir: null }), true)
    assert.equal(r.code, 401, u)
  }
  assert.equal(calls.length, 0)
  void db
})
