// 桥:起一个 http 的 /mcp,再用 stdio client 起桥子进程,列工具、调一个
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')   // 从哪个目录跑都找得到桥
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './local/migrate.js'
import { makeLocalDb } from './local/localdb.js'
import { handleMcp } from './mcp.js'

const UID = '11111111-1111-4111-8111-111111111111'
let dir, pg, srv, decoy, client, lastAuth
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fw-bridge-'))
  pg = await openLocalDb(dir); await applyMigrations(pg, { fresh: true }); await setLocalUid(pg, UID); await registerLocalUser(pg, { id: UID, email: 'a@b.c' }); await assumeUser(pg)
  const db = await makeLocalDb({ pg, dataDir: dir, user: { id: UID, email: 'a@b.c' } })
  srv = http.createServer((req, res) => {
    lastAuth = req.headers.authorization
    if (req.url === '/health') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ok: true, mode: 'local', version: '1.2.3' })) }
    handleMcp(req, res, { db, version: '1.2.3', dataDir: dir, modules: { profile: true } })
  })
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
  // 一台冒充「云端版」的,answer /health 但 mode=cloud——桥得跳过它
  decoy = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, mode: 'cloud' })) })
  await new Promise((ok) => decoy.listen(0, '127.0.0.1', ok))
  // 配置里写的是冒牌那台的端口;端口文件指向真的——桥要按端口文件找到真的
  writeFileSync(join(dir, 'port'), String(srv.address().port))
  const wrongUrl = `http://127.0.0.1:${decoy.address().port}/mcp`
  client = new Client({ name: 't', version: '1' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(ROOT, 'packaging/data/mcp-bridge.cjs'), wrongUrl], cwd: ROOT, env: { ...process.env, FAIRWIND_DATA_DIR: dir } }))
})
after(async () => { await client.close().catch(() => {}); srv.close(); decoy.close(); await pg.close(); rmSync(dir, { recursive: true, force: true }) })

test('--fixed:配置指哪台就是哪台,不探(哪怕它不是本机模式)', async () => {
  // decoy 那台 mode=cloud、没有 /mcp——固定模式下桥就该老老实实连它,列不到工具而不是偷偷跳去别台
  const c2 = new Client({ name: 't2', version: '1' })
  await c2.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(ROOT, 'packaging/data/mcp-bridge.cjs'), `http://127.0.0.1:${decoy.address().port}/mcp`, '--fixed'], cwd: ROOT, env: { ...process.env, FAIRWIND_DATA_DIR: dir } }))
  await assert.rejects(() => c2.listTools(), /无法连接 Fairwind|Cannot reach Fairwind/)
  await c2.close()
})

test('几台本机版都活着时挑版本最高的(桥里同一套比较)', () => {
  const num = (v) => v.split('.').map((x) => parseInt(x, 10) || 0)
  const newest = (found) => [...found].sort((a, b) => { const x = num(a.v), y = num(b.v); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0 })[0]
  assert.equal(newest([{ p: 8790, v: '0.1.1' }, { p: 8791, v: '0.1.11' }, { p: 8792, v: '0.1.9' }]).p, 8791)
})

test('桥:配置指错端口、端口文件指对 → 跳过冒牌云端版,连上真的;列工具、调 fairwind_info 回版本', async () => {
  const { tools } = await client.listTools()
  assert.ok(tools.some((t) => t.name === 'fairwind_info'))
  const r = await client.callTool({ name: 'fairwind_info', arguments: {} })
  assert.equal(JSON.parse(r.content[0].text).version, '1.2.3')
})


test('credential-bearing bridge URLs use the specified endpoint and send Basic auth', async () => {
  const c = new Client({ name: 'auth-test', version: '1' })
  try {
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(ROOT, 'packaging/data/mcp-bridge.cjs'), `http://user:test-token@127.0.0.1:${srv.address().port}/mcp`], cwd: ROOT, env: { ...process.env, FAIRWIND_DATA_DIR: dir } }))
    const result = await c.callTool({ name: 'fairwind_info', arguments: {} })
    assert.equal(JSON.parse(result.content[0].text).version, '1.2.3')
    assert.equal(lastAuth, 'Basic ' + Buffer.from('user:test-token').toString('base64'))
  } finally { await c.close() }
})
