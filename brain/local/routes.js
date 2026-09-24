// brain/local/routes.js —— 本机模式下 brain 多出来的几条路:前端借它碰库、碰文件、问「我是谁」,
// 以及首次启动的 /setup。云端模式下这个文件什么都不做(前端直连 Supabase)。
import { readFileSync, existsSync, statSync } from 'node:fs'
import { normalize, resolve, extname } from 'node:path'
import { saveSettings } from './settings.js'
import { registerLocalUser } from './migrate.js'
import { setJudgmentsEnabled, readJudgmentFiles, writeJudgmentFile } from '../judgments.js'
import { backupNow, listBackups, scheduleRestore } from './backup.js'
import { checkUpdate, applyUpdate } from './update.js'
import { VERSION } from '../version.js'
import { homedir } from 'node:os'
import { mkdirSync as mkdirp, readFileSync as readF, writeFileSync as writeF, existsSync as existsF } from 'node:fs'
import { join as pjoin, dirname as pdirname } from 'node:path'

// 发布位:打包时 define 进来;env 能盖(验收用 file://)。没配 = 检查更新会明说「没配发布位」
// eslint-disable-next-line no-undef
const RELEASE_URL = () => process.env.FAIRWIND_RELEASE_URL || (typeof __FAIRWIND_RELEASE_URL__ !== 'undefined' ? __FAIRWIND_RELEASE_URL__ : '')
let UPDATE = { at: 0, result: null }
/** 最近一次检查更新的结果(/health 带着走)。 */
export function lastUpdateCheck() { return UPDATE.result }
export async function refreshUpdateCheck({ force = false, fetchImpl } = {}) {
  if (!force && Date.now() - UPDATE.at < 3600_000 && UPDATE.result) return UPDATE.result
  UPDATE = { at: Date.now(), result: await checkUpdate({ current: VERSION, latestUrl: RELEASE_URL(), ...(fetchImpl ? { fetchImpl } : {}) }) }
  return UPDATE.result
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' }
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
const readAll = (req) => new Promise((ok, no) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no) })
const readJson = async (req) => { const b = await readAll(req); return b.length ? JSON.parse(b.toString()) : {} }

// ── Claude 桌面版:它只会起 stdio 子进程,够不着本机 http;桥(mcp-bridge.cjs)随包带着,这儿替人写进它的配置 ──
export function claudeDesktopConfigPath() {
  return process.env.FAIRWIND_CLAUDE_DESKTOP_CONFIG || (process.platform === 'darwin'
    ? pjoin(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : pjoin(process.env.APPDATA || homedir(), 'Claude', 'claude_desktop_config.json'))
}
/** 桥怎么起:包里是 <应用目录>/current/node + mcp-bridge.cjs;开发时是本机 node + packaging/data 那份 */
export function bridgeCommand(port) {
  const root = process.env.FAIRWIND_APP_ROOT
  const distDir = process.env.FAIRWIND_DIST_DIR
  const appDir = distDir ? pdirname(distDir) : null
  const packaged = appDir && existsF(pjoin(appDir, 'mcp-bridge.cjs'))
  const command = packaged && root ? pjoin(root, 'current', 'node') : process.execPath
  const bridge = packaged ? (root ? pjoin(root, 'current', 'mcp-bridge.cjs') : pjoin(appDir, 'mcp-bridge.cjs')) : pjoin(pdirname(new URL(import.meta.url).pathname), '..', '..', 'packaging', 'data', 'mcp-bridge.cjs')
  return { command, args: [bridge, `http://localhost:${port}/mcp`] }
}
export function claudeDesktopStatus(port) {
  const p = claudeDesktopConfigPath()
  let cfg = null; try { cfg = JSON.parse(readF(p, 'utf8')) } catch (_) {}
  const entry = cfg?.mcpServers?.fairwind || null
  const want = bridgeCommand(port)
  return { configPath: p, installed: Boolean(entry), current: entry && entry.command === want.command && JSON.stringify(entry.args) === JSON.stringify(want.args), appInstalled: process.platform === 'darwin' ? existsF('/Applications/Claude.app') : null }
}
export function installClaudeDesktop(port) {
  const p = claudeDesktopConfigPath()
  let cfg = {}; try { cfg = JSON.parse(readF(p, 'utf8')) } catch (_) {}
  cfg.mcpServers = { ...(cfg.mcpServers || {}), fairwind: bridgeCommand(port) }
  mkdirp(pdirname(p), { recursive: true })
  writeF(p, JSON.stringify(cfg, null, 2) + '\n')
  return claudeDesktopStatus(port)
}

/** settings 里能给页面看的那几样。**key 永不回显**,只给「设了没有」和末四位。 */
export function publicSettings(s) {
  const k = s.apiKey || '', o = s.oauthToken || ''
  const hint = (v, head) => (v ? `${v.slice(0, head)}…${v.slice(-4)}` : '')
  return { email: s.email || '', provider: s.provider || 'claude-key', oauthTokenSet: Boolean(o), oauthTokenHint: hint(o, 12),
           openaiKeySet: Boolean(s.openaiKey), openaiKeyHint: hint(s.openaiKey || '', 6), geminiKeySet: Boolean(s.geminiKey), geminiKeyHint: hint(s.geminiKey || '', 6), model: s.model || '', modelCheap: s.modelCheap || '', backupDir: s.backupDir || '',
           judgmentsEnabled: s.judgmentsEnabled !== false, lang: s.lang === 'en' ? 'en' : 'zh',
           ready: Boolean(s.ready), apiKeySet: Boolean(k), apiKeyHint: k ? `${k.slice(0, 7)}…${k.slice(-4)}` : '' }
}

/** 把 settings 推进 process.env。启动时(server.js connect)和改完都调。 */
export function exportEnv(s) {
  // 选哪条就只留哪条的凭据在 env 里:Claude 两条走 SDK(ANTHROPIC_API_KEY 或 CLAUDE_CODE_OAUTH_TOKEN),
  // GPT / Gemini 走 engine/openaiCompat(FAIRWIND_PROVIDER + 各自的 key)
  for (const k of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'GEMINI_API_KEY']) delete process.env[k]
  process.env.FAIRWIND_PROVIDER = s.provider === 'openai' || s.provider === 'gemini' ? s.provider : 'claude'
  if (s.provider === 'claude-subscription') { if (s.oauthToken) process.env.CLAUDE_CODE_OAUTH_TOKEN = s.oauthToken }
  else if (s.provider === 'openai') { if (s.openaiKey) process.env.OPENAI_API_KEY = s.openaiKey }
  else if (s.provider === 'gemini') { if (s.geminiKey) process.env.GEMINI_API_KEY = s.geminiKey }
  else if (s.apiKey) process.env.ANTHROPIC_API_KEY = s.apiKey
  process.env.BRAIN_MODEL = s.model || ''
  process.env.BRAIN_MODEL_CHEAP = s.modelCheap || ''
  setJudgmentsEnabled(s.judgmentsEnabled !== false)
  process.env.FAIRWIND_LANG = s.lang === 'en' ? 'en' : 'zh'   // brain 的提示词按它决定跟 ta 说哪种语言
}

/**
 * 处理了返回 true;不是这儿的事返回 false,交给 server.js 原来的分发。
 * ctx = { db, pg, mode, dataDir, settings, distDir, onSetup }
 */
export async function handleLocalRoute(req, res, ctx) {
  if (ctx.mode !== 'local') return false
  const { db, dataDir, distDir } = ctx
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname

  if (req.method === 'GET' && p === '/me') {
    const s = ctx.settings
    json(res, 200, { mode: 'local', ready: Boolean(s.ready), lang: s.lang === 'en' ? 'en' : 'zh', user: s.ready ? { id: s.uid, email: s.email } : null })
    return true
  }

  // 首次启动(/setup)和之后在「关于你」底下改(/settings)走同一条:存盘、登记、把 key 和模型档位
  // 推进 process.env(SDK 起子进程、models.js 挑档位,读的都是 env,所以改完当场生效,不用重启)。
  if (req.method === 'POST' && (p === '/setup' || p === '/settings')) {
    const body = await readJson(req)
    const patch = {}
    for (const k of ['email', 'model', 'modelCheap', 'backupDir']) if (typeof body[k] === 'string') patch[k] = body[k].trim()
    if (typeof body.apiKey === 'string' && body.apiKey.trim()) patch.apiKey = body.apiKey.trim()   // 空着 = 不动原来的
    for (const k of ['oauthToken', 'openaiKey', 'geminiKey']) if (typeof body[k] === 'string' && body[k].trim()) patch[k] = body[k].trim()
    if (['claude-key', 'claude-subscription', 'openai', 'gemini'].includes(body.provider)) patch.provider = body.provider
    if (typeof body.judgmentsEnabled === 'boolean') patch.judgmentsEnabled = body.judgmentsEnabled
    if (body.lang === 'zh' || body.lang === 'en') patch.lang = body.lang
    const s = saveSettings(dataDir, patch)
    ctx.settings = s
    if (s.email) await registerLocalUser(ctx.pg, { id: s.uid, email: s.email })
    exportEnv(s)
    db.setUser?.({ id: s.uid, email: s.email })
    await ctx.onSetup?.(s)
    json(res, 200, { ok: true, ready: s.ready, ...publicSettings(s) })
    return true
  }

  if (req.method === 'GET' && p === '/settings') { json(res, 200, { ...publicSettings(ctx.settings), dataDir, judgmentsDir: `${dataDir}/judgments` }); return true }
  // 更新之后旧进程还在跑,启动器会看见版本对不上,叫它退场再起新的。只听本机,别人叫不动
  if (req.method === 'POST' && p === '/quit') { json(res, 200, { ok: true, bye: true }); setTimeout(() => (ctx.exit || process.exit)(0), 200); return true }

  // ── 判据文档:页面上直接改(不想开终端的人也能用;MCP 那条路写的是同几个文件)──
  if (req.method === 'GET' && p === '/judgments/files') { json(res, 200, { dir: `${dataDir}/judgments`, files: readJudgmentFiles(`${dataDir}/judgments`) }); return true }
  if (req.method === 'POST' && p === '/judgments/files') {
    const body = await readJson(req)
    try { const lints = writeJudgmentFile(`${dataDir}/judgments`, body.file, body.content); json(res, 200, { ok: true, lints }) }
    catch (e) { json(res, 400, { ok: false, error: e.message }) }
    return true
  }

  if (req.method === 'GET' && p === '/mcp/claude-desktop') { json(res, 200, claudeDesktopStatus(process.env.BRAIN_PORT || 8788)); return true }
  if (req.method === 'POST' && p === '/mcp/claude-desktop') {
    try { json(res, 200, { ok: true, ...installClaudeDesktop(process.env.BRAIN_PORT || 8788) }) } catch (e) { json(res, 500, { ok: false, error: e.message }) }
    return true
  }

  // ── 备份 ──
  if (req.method === 'GET' && p === '/backup/list') { json(res, 200, { dir: ctx.settings.backupDir || '', files: listBackups(ctx.settings.backupDir) }); return true }
  if (req.method === 'POST' && p === '/backup/now') {
    try { const file = await backupNow(ctx.pg, ctx.settings.backupDir); json(res, 200, { ok: true, file }) }
    catch (e) { json(res, 400, { ok: false, error: e.message }) }
    return true
  }
  if (req.method === 'POST' && p === '/backup/restore') {
    const body = await readJson(req)
    try { const marker = scheduleRestore(dataDir, body.path); json(res, 200, { ok: true, marker, restart: true }) }
    catch (e) { json(res, 400, { ok: false, error: e.message }) }
    return true
  }

  // ── 更新:检查自动(启动 + 每小时),执行靠人点 ──
  if (req.method === 'GET' && p === '/update/check') {
    json(res, 200, await refreshUpdateCheck({ force: url.searchParams.has('force'), fetchImpl: ctx.fetchImpl })); return true
  }
  if (req.method === 'POST' && p === '/update/apply') {
    const info = await refreshUpdateCheck({ fetchImpl: ctx.fetchImpl })
    if (!info?.canUpdate) { json(res, 400, { ok: false, error: info?.error || '没有新版本' }); return true }
    try {
      let backup = null
      if (ctx.settings.backupDir) backup = await backupNow(ctx.pg, ctx.settings.backupDir)   // 更新前先备一份
      const r = await applyUpdate({ appRoot: process.env.FAIRWIND_APP_ROOT, version: info.latest, url: info.url, sha256: info.sha256, fetchImpl: ctx.fetchImpl, log: (s) => console.log(s) })
      json(res, 200, { ok: true, ...r, backup, restart: true })
    } catch (e) { json(res, 500, { ok: false, error: e.message }) }
    return true
  }

  if (req.method === 'POST' && p.startsWith('/db/rpc/')) {
    const name = p.slice('/db/rpc/'.length)
    json(res, 200, await db.rpc(name, await readJson(req)))
    return true
  }

  if (req.method === 'POST' && p === '/db/from') {
    const q = await readJson(req)
    let b = db.from(q.view).select(q.select || '*', q.count ? { count: q.count, head: Boolean(q.head) } : {})
    for (const [op, col, v] of q.filters || []) b = op === 'in' ? b.in(col, v) : op === 'is' ? b.is(col, v) : op === 'or' ? b.or(col) : b.eq(col, v)
    for (const o of q.order || []) b = b.order(o.col, { ascending: o.ascending !== false })
    if (q.limit != null) b = b.limit(q.limit)
    if (q.single === 'maybe') b = b.maybeSingle()
    json(res, 200, await b)
    return true
  }

  if (p.startsWith('/files/')) {
    const key = decodeURIComponent(p.slice('/files/'.length))
    const s = db.storage.from('pursuit-files')
    if (req.method === 'PUT') {
      const r = await s.upload(key, await readAll(req), { contentType: req.headers['content-type'] })
      json(res, r.error ? 400 : 200, r); return true
    }
    if (req.method === 'DELETE') { const r = await s.remove([key]); json(res, r.error ? 400 : 200, r); return true }
    if (req.method === 'GET') {
      const r = await s.download(key)
      if (r.error) { json(res, 404, r); return true }
      res.writeHead(200, { 'content-type': s.contentTypeOf(key) }); res.end(Buffer.from(await r.data.arrayBuffer())); return true
    }
  }

  // 静态:dist/ 里真有的文件才出;/ 回 index.html。别的路径不接——交给 server.js 自己的路由
  // (前端按 ?a= 路由,路径永远是 /,所以不需要"找不到就回 index"那种兜底;
  //  有了那种兜底,/health 这种 brain 自己的 GET 会被静态页吃掉——2026-09-16 冒烟时撞到的)。
  if (req.method === 'GET' && distDir && existsSync(distDir)) {
    const rel = p === '/' ? 'index.html' : normalize(p).replace(/^\/+/, '')
    const f = resolve(distDir, rel)
    if (f.startsWith(resolve(distDir)) && existsSync(f) && !statSync(f).isDirectory()) {
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return true
    }
  }
  return false
}
