// brain/local/routes.test.js
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { openLocalDb, applyMigrations, setLocalUid, assumeUser } from './migrate.js'
import { makeLocalDb } from './localdb.js'
import { saveSettings } from './settings.js'
import { handleLocalRoute } from './routes.js'

const UID = '11111111-1111-4111-8111-111111111111'
let dir, pg, ctx
const req = (method, url, body, headers = {}) => Object.assign(Readable.from(body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]), { method, url, headers: { 'content-type': 'application/json', ...headers } })
const res = () => { const r = { code: 0, headers: {}, chunks: [] }; r.writeHead = (c, h) => { r.code = c; Object.assign(r.headers, h || {}); return r }; r.setHeader = (k, v) => { r.headers[k] = v }; r.end = (b) => { if (b) r.chunks.push(Buffer.from(b)); r.done = true }; r.write = (b) => r.chunks.push(Buffer.from(b)); r.json = () => JSON.parse(Buffer.concat(r.chunks).toString()); r.text = () => Buffer.concat(r.chunks).toString(); return r }

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fw-routes-'))
  pg = await openLocalDb(dir); await applyMigrations(pg, { fresh: true }); await setLocalUid(pg, UID)
  const settings = saveSettings(dir, { uid: UID })   // settings.json 里的 uid 要跟 set_config 的一致
  await assumeUser(pg)
  const db = await makeLocalDb({ pg, dataDir: dir, user: { id: UID, email: '' } })
  mkdirSync(join(dir, 'dist')); writeFileSync(join(dir, 'dist', 'index.html'), '<h1>hi</h1>')
  ctx = { db, pg, mode: 'local', dataDir: dir, settings, distDir: join(dir, 'dist'), onSetup: async () => {} }
})
after(async () => { await pg.close(); rmSync(dir, { recursive: true, force: true }) })

test('/me:未初始化 → ready:false', async () => {
  const r = res(); assert.equal(await handleLocalRoute(req('GET', '/me'), r, ctx), true)
  assert.deepEqual(r.json(), { mode: 'local', ready: false, user: null })
})

test('/setup 写 settings、注册用户,之后 /me ready:true', async () => {
  const r = res()
  await handleLocalRoute(req('POST', '/setup', { email: 'a@b.c', apiKey: 'sk-ant-1', backupDir: '' }), r, ctx)
  assert.equal(r.json().ready, true)
  const m = res(); await handleLocalRoute(req('GET', '/me'), m, ctx)
  assert.deepEqual(m.json().user, { id: UID, email: 'a@b.c' })
  const p = await pg.query('select count(*)::int as n from public.v_pa_profile'); assert.equal(p.rows[0].n, 1)
})

test('/settings:GET 不回显 key,只给末四位;POST 空 key 不动原来的,改模型档位当场进 env', async () => {
  const g = res(); await handleLocalRoute(req('GET', '/settings'), g, ctx)
  const j = g.json(); assert.equal(j.apiKeySet, true); assert.equal(j.apiKeyHint, 'sk-ant-…nt-1'); assert.equal(JSON.stringify(j).includes('sk-ant-1'), false)
  const w = res(); await handleLocalRoute(req('POST', '/settings', { apiKey: '', model: 'claude-opus-5', modelCheap: 'claude-haiku-4-5-20251001' }), w, ctx)
  assert.equal(w.json().apiKeySet, true); assert.equal(process.env.ANTHROPIC_API_KEY, 'sk-ant-1'); assert.equal(process.env.BRAIN_MODEL, 'claude-opus-5')
  const w2 = res(); await handleLocalRoute(req('POST', '/settings', { apiKey: 'sk-ant-9999' }), w2, ctx)
  assert.equal(w2.json().apiKeyHint, 'sk-ant-…9999'); assert.equal(process.env.ANTHROPIC_API_KEY, 'sk-ant-9999')
})

test('/db/rpc 和 /db/from 原样转发', async () => {
  const w = res(); await handleLocalRoute(req('POST', '/db/rpc/pa_set_profile', { p_name: 'X' }), w, ctx)
  assert.equal(w.json().error, null)
  const r = res(); await handleLocalRoute(req('POST', '/db/from', { view: 'v_pa_profile', select: '*', filters: [], order: [], limit: null, single: 'maybe' }), r, ctx)
  assert.equal(r.json().data.name, 'X')
})

test('/files PUT → GET → DELETE,带 content-type', async () => {
  const k = encodeURIComponent('p1/a.txt')
  const w = res(); await handleLocalRoute(req('PUT', `/files/${k}`, Buffer.from('hey'), { 'content-type': 'text/plain' }), w, ctx); assert.equal(w.code, 200)
  const g = res(); await handleLocalRoute(req('GET', `/files/${k}`), g, ctx); assert.equal(g.text(), 'hey'); assert.equal(g.headers['content-type'], 'text/plain')
  const d = res(); await handleLocalRoute(req('DELETE', `/files/${k}`), d, ctx); assert.equal(d.code, 200)
  const g2 = res(); await handleLocalRoute(req('GET', `/files/${k}`), g2, ctx); assert.equal(g2.code, 404)
})

test('GET / 从 dist 出', async () => {
  const r = res(); assert.equal(await handleLocalRoute(req('GET', '/'), r, ctx), true); assert.equal(r.text(), '<h1>hi</h1>')
})

test('GET /health 不是静态文件,不接——留给 server.js 自己的路由', async () => {
  const r = res(); assert.equal(await handleLocalRoute(req('GET', '/health'), r, ctx), false)
})

test('不是本地模式:/db/* 不处理', async () => {
  const r = res(); assert.equal(await handleLocalRoute(req('POST', '/db/rpc/x', {}), r, { ...ctx, mode: 'service' }), false)
})
