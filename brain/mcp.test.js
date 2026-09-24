// 用官方 client 走一遍 Streamable HTTP:列工具、加一条、列出来、改一条、挂图。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './local/migrate.js'
import { makeLocalDb } from './local/localdb.js'
import { handleMcp } from './mcp.js'

const UID = '11111111-1111-4111-8111-111111111111'
let dir, pg, srv, client, port
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fw-mcp-'))
  pg = await openLocalDb(dir); await applyMigrations(pg, { fresh: true }); await setLocalUid(pg, UID); await registerLocalUser(pg, { id: UID, email: 'a@b.c' }); await assumeUser(pg)
  const db = await makeLocalDb({ pg, dataDir: dir, user: { id: UID, email: 'a@b.c' } })
  srv = http.createServer((req, res) => handleMcp(req, res, { db, version: '9.9.9', dataDir: dir, modules: { profile: true } }))
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); port = srv.address().port
  client = new Client({ name: 'test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)))
})
after(async () => { await client.close().catch(() => {}); srv.close(); await pg.close(); rmSync(dir, { recursive: true, force: true }) })

const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); const t = r.content?.[0]?.text || ''; return { r, t, j: (() => { try { return JSON.parse(t) } catch { return null } })() } }

test('列工具:六个,名字都带 fairwind_', async () => {
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name).sort(), ['fairwind_entries_list', 'fairwind_entry_add', 'fairwind_entry_set', 'fairwind_info', 'fairwind_profile_get', 'fairwind_profile_set'])
})

test('info 说版本和判据目录;profile 改了读得回', async () => {
  const i = await call('fairwind_info'); assert.equal(i.j.version, '9.9.9'); assert.ok(i.j.judgmentsDir.endsWith('/judgments'))
  await call('fairwind_profile_set', { name: '测试人', website: 'https://x.art', location: ['LA', 'SF'] })
  const p = await call('fairwind_profile_get'); assert.equal(p.j.name, '测试人'); assert.deepEqual(p.j.data.location, ['LA', 'SF'])
})

test('加一条作品带图 → 列出来 → 改标题和草稿 → 再列', async () => {
  const a = await call('fairwind_entry_add', { kind: 'work', title: '回声', medium: '装置', year: '2025', body: '一句话', images: ['https://x.art/a.jpg'], site_path: '/work/echo' })
  assert.equal(a.j.ok, true); assert.ok(a.j.id)
  let l = await call('fairwind_entries_list', { kind: 'work' }); assert.equal(l.j.length, 1); assert.equal(l.j[0].title, '回声'); assert.deepEqual(l.j[0].images, ['https://x.art/a.jpg']); assert.equal(l.j[0].site_path, '/work/echo')
  await call('fairwind_entry_set', { id: a.j.id, title: '回声（改）', draft: true })
  l = await call('fairwind_entries_list'); assert.equal(l.j[0].title, '回声（改）'); assert.equal(l.j[0].draft, true)
  const bad = await call('fairwind_entry_set', { id: '00000000-0000-4000-8000-000000000000', title: 'x' }); assert.equal(bad.r.isError, true)
})
