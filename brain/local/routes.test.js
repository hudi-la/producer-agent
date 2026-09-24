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
  assert.deepEqual(r.json(), { mode: 'local', ready: false, lang: 'zh', user: null })
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

test('备份路由:没选目录 → 说清;选了 → 备出文件、列表能看到;恢复排上标记', async () => {
  const { mkdtempSync: mk, existsSync: ex } = await import('node:fs'); const { tmpdir: td } = await import('node:os'); const { join: jn } = await import('node:path')
  const a = res(); await handleLocalRoute(req('POST', '/backup/now', {}), a, ctx); assert.equal(a.code, 400); assert.match(a.json().error, /备份目录/)
  const bdir = mk(jn(td(), 'fw-rb-'))
  await handleLocalRoute(req('POST', '/settings', { backupDir: bdir }), res(), ctx)
  const b = res(); await handleLocalRoute(req('POST', '/backup/now', {}), b, ctx); assert.equal(b.json().ok, true); assert.ok(ex(b.json().file))
  const l = res(); await handleLocalRoute(req('GET', '/backup/list'), l, ctx); assert.equal(l.json().files.length, 1)
  const r = res(); await handleLocalRoute(req('POST', '/backup/restore', { path: b.json().file }), r, ctx); assert.equal(r.json().restart, true); assert.ok(ex(jn(dir, 'restore.tar.gz')))
  const bad = res(); await handleLocalRoute(req('POST', '/backup/restore', { path: '/nope.tar.gz' }), bad, ctx); assert.equal(bad.code, 400)
})

test('更新路由:没配发布位 → check 说原因、apply 400;配了假发布位 → check 认新版', async () => {
  const c0 = res(); await handleLocalRoute(req('GET', '/update/check?force'), c0, ctx); assert.equal(c0.json().canUpdate, false); assert.match(c0.json().error, /发布位/)
  const a0 = res(); await handleLocalRoute(req('POST', '/update/apply', {}), a0, ctx); assert.equal(a0.code, 400)
  process.env.FAIRWIND_RELEASE_URL = 'http://fake/latest.json'
  const fetchImpl = async (u) => ({ ok: true, status: 200, json: async () => ({ version: '9.9.9', note: 'x', platforms: { [`${process.platform === 'darwin' ? 'mac' : 'win'}-${process.arch}`]: { url: '/Fairwind-9.9.9.zip', sha256: 'a' } } }) })
  const c1 = res(); await handleLocalRoute(req('GET', '/update/check?force'), c1, { ...ctx, fetchImpl }); assert.equal(c1.json().canUpdate, true); assert.equal(c1.json().latest, '9.9.9')
  delete process.env.FAIRWIND_RELEASE_URL
})

test('/settings:切到订阅路 → env 里只剩 CLAUDE_CODE_OAUTH_TOKEN;切回 key → 只剩 ANTHROPIC_API_KEY;令牌不回显', async () => {
  const a = res(); await handleLocalRoute(req('POST', '/settings', { provider: 'claude-subscription', oauthToken: 'sk-ant-oat01-abcdefgh-9999' }), a, ctx)
  assert.equal(a.json().provider, 'claude-subscription'); assert.equal(a.json().oauthTokenSet, true); assert.equal(a.json().oauthTokenHint, 'sk-ant-oat01…9999')
  assert.equal(JSON.stringify(a.json()).includes('abcdefgh'), false)
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat01-abcdefgh-9999'); assert.equal(process.env.ANTHROPIC_API_KEY, undefined)
  const b = res(); await handleLocalRoute(req('POST', '/settings', { provider: 'claude-key' }), b, ctx)
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, undefined); assert.ok(process.env.ANTHROPIC_API_KEY)
})

test('/settings:切到 gemini → env 里 FAIRWIND_PROVIDER=gemini + GEMINI_API_KEY,别家的 key 清掉;切回 claude-key 反过来', async () => {
  const a = res(); await handleLocalRoute(req('POST', '/settings', { provider: 'gemini', geminiKey: 'AIzaSy-test-key-7777' }), a, ctx)
  assert.equal(a.json().provider, 'gemini'); assert.equal(a.json().geminiKeyHint, 'AIzaSy…7777'); assert.equal(JSON.stringify(a.json()).includes('test-key'), false)
  assert.equal(process.env.FAIRWIND_PROVIDER, 'gemini'); assert.equal(process.env.GEMINI_API_KEY, 'AIzaSy-test-key-7777'); assert.equal(process.env.ANTHROPIC_API_KEY, undefined)
  const b = res(); await handleLocalRoute(req('POST', '/settings', { provider: 'claude-key' }), b, ctx)
  assert.equal(process.env.FAIRWIND_PROVIDER, 'claude'); assert.equal(process.env.GEMINI_API_KEY, undefined); assert.ok(process.env.ANTHROPIC_API_KEY)
})

test('/quit:答一声再退场(退场用注入的 exit,测试里不真退)', async () => {
  let code = null
  const r = res(); await handleLocalRoute(req('POST', '/quit', {}), r, { ...ctx, exit: (c) => { code = c } })
  assert.deepEqual(r.json(), { ok: true, bye: true })
  await new Promise((ok) => setTimeout(ok, 300)); assert.equal(code, 0)
})

test('/judgments/files:读五个(空串)→ 写一个 → 读回;坏文件名 400', async () => {
  const g = res(); await handleLocalRoute(req('GET', '/judgments/files'), g, ctx); assert.deepEqual(Object.keys(g.json().files).length, 5)
  const w = res(); await handleLocalRoute(req('POST', '/judgments/files', { file: '手记.md', content: '交了表就等 20 天' }), w, ctx); assert.equal(w.json().ok, true)
  const g2 = res(); await handleLocalRoute(req('GET', '/judgments/files'), g2, ctx); assert.equal(g2.json().files['手记.md'], '交了表就等 20 天')
  const bad = res(); await handleLocalRoute(req('POST', '/judgments/files', { file: 'x.md', content: '' }), bad, ctx); assert.equal(bad.code, 400)
})

test('/mcp/claude-desktop:没配 → installed:false;POST 写进配置(别的键不动);再 GET → current:true', async () => {
  const { mkdtempSync: mk, writeFileSync: wf, readFileSync: rf } = await import('node:fs'); const { tmpdir: td } = await import('node:os'); const { join: jn } = await import('node:path')
  const cdir = mk(jn(td(), 'fw-cd-')); process.env.FAIRWIND_CLAUDE_DESKTOP_CONFIG = jn(cdir, 'claude_desktop_config.json'); process.env.BRAIN_PORT = '8799'
  wf(process.env.FAIRWIND_CLAUDE_DESKTOP_CONFIG, JSON.stringify({ preferences: { x: 1 }, mcpServers: { other: { command: 'x' } } }))
  const g = res(); await handleLocalRoute(req('GET', '/mcp/claude-desktop'), g, ctx); assert.equal(g.json().installed, false)
  const w = res(); await handleLocalRoute(req('POST', '/mcp/claude-desktop', {}), w, ctx); assert.equal(w.json().ok, true); assert.equal(w.json().current, true)
  const cfg = JSON.parse(rf(process.env.FAIRWIND_CLAUDE_DESKTOP_CONFIG, 'utf8'))
  assert.equal(cfg.preferences.x, 1); assert.equal(cfg.mcpServers.other.command, 'x'); assert.match(cfg.mcpServers.fairwind.args[0], /mcp-bridge\.cjs$/); assert.equal(cfg.mcpServers.fairwind.args[1], 'http://localhost:8799/mcp')
  delete process.env.FAIRWIND_CLAUDE_DESKTOP_CONFIG; delete process.env.BRAIN_PORT
})

test('/mcp/targets:codex 写 toml(已有内容保留、重写不重复);gemini 写 json;不认识的目标 400', async () => {
  const { mkdtempSync: mk, writeFileSync: wf, readFileSync: rf } = await import('node:fs'); const { tmpdir: td } = await import('node:os'); const { join: jn } = await import('node:path')
  const d = mk(jn(td(), 'fw-tg-')); process.env.FAIRWIND_CODEX_CONFIG = jn(d, 'config.toml'); process.env.FAIRWIND_GEMINI_CONFIG = jn(d, 'settings.json'); process.env.BRAIN_PORT = '8799'
  wf(process.env.FAIRWIND_CODEX_CONFIG, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n')
  let w = res(); await handleLocalRoute(req('POST', '/mcp/targets', { target: 'codex' }), w, ctx); assert.equal(w.json().current, true, w.text())
  w = res(); await handleLocalRoute(req('POST', '/mcp/targets', { target: 'codex' }), w, ctx)
  const toml = rf(process.env.FAIRWIND_CODEX_CONFIG, 'utf8')
  assert.equal((toml.match(/\[mcp_servers\.fairwind\]/g) || []).length, 1); assert.match(toml, /model = "gpt-5"/); assert.match(toml, /\[mcp_servers\.other\]/); assert.match(toml, /http:\/\/localhost:8799\/mcp/)
  w = res(); await handleLocalRoute(req('POST', '/mcp/targets', { target: 'gemini-cli' }), w, ctx); assert.equal(w.json().current, true)
  assert.equal(JSON.parse(rf(process.env.FAIRWIND_GEMINI_CONFIG, 'utf8')).mcpServers.fairwind.args[1], 'http://localhost:8799/mcp')
  const g = res(); await handleLocalRoute(req('GET', '/mcp/targets'), g, ctx); assert.equal(g.json().length, 3); assert.equal(g.json().find((x) => x.target === 'codex').current, true)
  const bad = res(); await handleLocalRoute(req('POST', '/mcp/targets', { target: 'chatgpt' }), bad, ctx); assert.equal(bad.code, 400)
  delete process.env.FAIRWIND_CODEX_CONFIG; delete process.env.FAIRWIND_GEMINI_CONFIG; delete process.env.BRAIN_PORT
})

test('/setup 选了英文 → 出厂那条找机会任务换成英文;再选中文换回来', async () => {
  const { SCOUT_DEFAULT } = await import('../scoutDefault.js')
  const get = async () => (await ctx.pg.query("select prompt from producer.tasks where owner = $1 and type = 'scout_aggregators'", [ctx.settings.uid])).rows[0]?.prompt
  let w = res(); await handleLocalRoute(req('POST', '/setup', { email: 'seed@example.com', lang: 'en', provider: 'claude-key', apiKey: 'sk-ant-x' }), w, ctx); assert.equal(w.code, 200, w.text())
  assert.equal(await get(), SCOUT_DEFAULT.en)
  w = res(); await handleLocalRoute(req('POST', '/settings', { lang: 'zh' }), w, ctx); assert.equal(w.code, 200)
  assert.equal(await get(), SCOUT_DEFAULT.zh)
})
