// 桥:起一个 http 的 /mcp,再用 stdio client 起桥子进程,列工具、调一个
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './local/migrate.js'
import { makeLocalDb } from './local/localdb.js'
import { handleMcp } from './mcp.js'

const UID = '11111111-1111-4111-8111-111111111111'
let dir, pg, srv, client
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fw-bridge-'))
  pg = await openLocalDb(dir); await applyMigrations(pg, { fresh: true }); await setLocalUid(pg, UID); await registerLocalUser(pg, { id: UID, email: 'a@b.c' }); await assumeUser(pg)
  const db = await makeLocalDb({ pg, dataDir: dir, user: { id: UID, email: 'a@b.c' } })
  srv = http.createServer((req, res) => handleMcp(req, res, { db, version: '1.2.3', dataDir: dir, modules: { profile: true } }))
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
  const url = `http://127.0.0.1:${srv.address().port}/mcp`
  client = new Client({ name: 't', version: '1' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('packaging/data/mcp-bridge.cjs'), url], cwd: resolve('.') }))
})
after(async () => { await client.close().catch(() => {}); srv.close(); await pg.close(); rmSync(dir, { recursive: true, force: true }) })

test('桥:stdio 那头列到 http 那头的工具,调 fairwind_info 回版本', async () => {
  const { tools } = await client.listTools()
  assert.ok(tools.some((t) => t.name === 'fairwind_info'))
  const r = await client.callTool({ name: 'fairwind_info', arguments: {} })
  assert.equal(JSON.parse(r.content[0].text).version, '1.2.3')
})
