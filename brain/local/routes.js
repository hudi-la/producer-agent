// brain/local/routes.js —— 本机模式下 brain 多出来的几条路:前端借它碰库、碰文件、问「我是谁」,
// 以及首次启动的 /setup。云端模式下这个文件什么都不做(前端直连 Supabase)。
import { readFileSync, existsSync, statSync } from 'node:fs'
import { normalize, resolve, extname } from 'node:path'
import { saveSettings } from './settings.js'
import { registerLocalUser } from './migrate.js'
import { setJudgmentsEnabled } from '../judgments.js'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' }
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
const readAll = (req) => new Promise((ok, no) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no) })
const readJson = async (req) => { const b = await readAll(req); return b.length ? JSON.parse(b.toString()) : {} }

/** settings 里能给页面看的那几样。**key 永不回显**,只给「设了没有」和末四位。 */
export function publicSettings(s) {
  const k = s.apiKey || ''
  return { email: s.email || '', model: s.model || '', modelCheap: s.modelCheap || '', backupDir: s.backupDir || '',
           judgmentsEnabled: s.judgmentsEnabled !== false,
           ready: Boolean(s.ready), apiKeySet: Boolean(k), apiKeyHint: k ? `${k.slice(0, 7)}…${k.slice(-4)}` : '' }
}

/** 把 settings 推进 process.env。启动时(server.js connect)和改完都调。 */
export function exportEnv(s) {
  if (s.apiKey) process.env.ANTHROPIC_API_KEY = s.apiKey
  process.env.BRAIN_MODEL = s.model || ''
  process.env.BRAIN_MODEL_CHEAP = s.modelCheap || ''
  setJudgmentsEnabled(s.judgmentsEnabled !== false)
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
    json(res, 200, { mode: 'local', ready: Boolean(s.ready), user: s.ready ? { id: s.uid, email: s.email } : null })
    return true
  }

  // 首次启动(/setup)和之后在「关于你」底下改(/settings)走同一条:存盘、登记、把 key 和模型档位
  // 推进 process.env(SDK 起子进程、models.js 挑档位,读的都是 env,所以改完当场生效,不用重启)。
  if (req.method === 'POST' && (p === '/setup' || p === '/settings')) {
    const body = await readJson(req)
    const patch = {}
    for (const k of ['email', 'model', 'modelCheap', 'backupDir']) if (typeof body[k] === 'string') patch[k] = body[k].trim()
    if (typeof body.apiKey === 'string' && body.apiKey.trim()) patch.apiKey = body.apiKey.trim()   // 空着 = 不动原来的
    if (typeof body.judgmentsEnabled === 'boolean') patch.judgmentsEnabled = body.judgmentsEnabled
    const s = saveSettings(dataDir, patch)
    ctx.settings = s
    if (s.email) await registerLocalUser(ctx.pg, { id: s.uid, email: s.email })
    exportEnv(s)
    db.setUser?.({ id: s.uid, email: s.email })
    await ctx.onSetup?.(s)
    json(res, 200, { ok: true, ready: s.ready, ...publicSettings(s) })
    return true
  }

  if (req.method === 'GET' && p === '/settings') { json(res, 200, publicSettings(ctx.settings)); return true }

  if (req.method === 'POST' && p.startsWith('/db/rpc/')) {
    const name = p.slice('/db/rpc/'.length)
    json(res, 200, await db.rpc(name, await readJson(req)))
    return true
  }

  if (req.method === 'POST' && p === '/db/from') {
    const q = await readJson(req)
    let b = db.from(q.view).select(q.select || '*')
    for (const [op, col, v] of q.filters || []) b = op === 'in' ? b.in(col, v) : b.eq(col, v)
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
