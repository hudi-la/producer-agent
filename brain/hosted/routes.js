// brain/hosted/routes.js —— 托管配置下按人的那几条路(设计稿 2026-10-02 六.2)。
//
// 本机版把这些放在 settings.json 和数据目录里(local/routes.js);托管把同样的东西放进库里那个人的
// member_settings / judgment_docs。进来的请求已经被 server.js 认过人(req 上带着租户上下文),
// 这里只管读写他自己的那一行——RLS 保证写不到别人。
//
//   GET  /me                  我是谁、语言、设置齐了没
//   GET  /settings            设置(key 只回显末几位)
//   POST /settings | /setup   改设置(只改传了的;空串清掉;填错栏的 key 拦下)
//   GET/POST /judgments/files 判据文档(跟本机版同一套界面)
//   /claude/*                 Claude 订阅一键登录,各人一个 HOME
//   /chatgpt/*                线上第一期不开(Codex 的 Linux 登录流程下一期验)
//   GET  /backup/export       我名下所有行 + 附件 → 一个 zip(brain/backup,跟本机版同一种包)
//   POST /backup/import       上传同样的 zip 写回;?wipe=1 先清我名下的行
//   POST /settings/mcp-token/rotate  换一串 MCP 令牌
//   GET 静态文件               dist/ 里真有的才出,/ 回 index.html
import { existsSync, statSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve, normalize, extname } from 'node:path'
import { currentTenant, rowFromSettings } from '../tenant.js'
import { wrongKey, PROVIDERS } from '../local/settings.js'
import { FILES as JUDGMENT_FILES, lintJudgments } from '../judgments.js'
import { createClaudeAuth } from '../local/claudeAuth.js'
import { handleBackupRoute } from '../backup/routes.js'
import { VERSION } from '../version.js'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json', '.md': 'text/markdown; charset=utf-8' }

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
async function readJson(req) { const chunks = []; for await (const c of req) chunks.push(c); try { return JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { return {} } }
const hint = (v, head) => (v ? `${v.slice(0, head)}…${v.slice(-4)}` : '')

/** 跟 local/routes.js 的 publicSettings 同形,页面同一套。key 永不回显。 */
export function publicSettingsOf(s) {
  return { email: s.email || '', provider: s.provider || 'claude-key',
           apiKeySet: Boolean(s.apiKey), apiKeyHint: s.apiKey ? `${s.apiKey.slice(0, 7)}…${s.apiKey.slice(-4)}` : '',
           oauthTokenSet: Boolean(s.oauthToken), oauthTokenHint: hint(s.oauthToken || '', 12),
           openaiKeySet: Boolean(s.openaiKey), openaiKeyHint: hint(s.openaiKey || '', 6), geminiKeySet: Boolean(s.geminiKey), geminiKeyHint: hint(s.geminiKey || '', 6),
           model: s.model || '', modelCheap: s.modelCheap || '', backupDir: '', judgmentsEnabled: s.judgmentsEnabled !== false, lang: s.lang === 'en' ? 'en' : 'zh',
           ready: Boolean(readyOf(s)), mcpToken: s.mcpToken || '' }
}
const readyOf = (s) => s.provider === 'claude-subscription' ? s.oauthToken : s.provider === 'openai' ? s.openaiKey : s.provider === 'gemini' ? s.geminiKey : s.provider === 'chatgpt-subscription' ? false : s.apiKey

/** 处理了返回 true;不是这儿的事返回 false。ctx = { hosted, distDir } */
export async function handleHostedRoute(req, res, ctx) {
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname
  const t = currentTenant()
  // 没带身份的只能看静态文件;别的路 server.js 已经拦了(401),这里再守一道
  const needsMe = (req.method === 'GET' && p === '/me') || p === '/settings' || p === '/setup' || p.startsWith('/claude/') || p.startsWith('/chatgpt/') || p === '/judgments/files' || p.startsWith('/backup/') || p === '/settings/mcp-token/rotate'
  if (needsMe && !t) { json(res, 401, { error: '请先登录 / sign in first' }); return true }

  if (req.method === 'GET' && p === '/me') {
    const s = t.settings
    json(res, 200, { mode: 'hosted', ready: Boolean(readyOf(s)), lang: s.lang === 'en' ? 'en' : 'zh', user: { id: t.owner, email: t.email } })
    return true
  }

  if (req.method === 'GET' && p === '/settings') { json(res, 200, { ...publicSettingsOf({ ...t.settings, email: t.email }), dataDir: '', judgmentsDir: '' }); return true }

  if (req.method === 'POST' && (p === '/setup' || p === '/settings')) {
    const body = await readJson(req)
    const patch = {}
    for (const k of ['model', 'modelCheap']) if (typeof body[k] === 'string') patch[k] = body[k].trim()
    for (const k of ['apiKey', 'oauthToken', 'openaiKey', 'geminiKey']) if (typeof body[k] === 'string' && body[k].trim()) patch[k] = body[k].trim()   // 空着 = 不动原来的
    { const bad = wrongKey(patch); if (bad) { json(res, 400, { error: { message: bad } }); return true } }
    if (PROVIDERS.includes(body.provider)) patch.provider = body.provider
    if (typeof body.judgmentsEnabled === 'boolean') patch.judgmentsEnabled = body.judgmentsEnabled
    if (body.lang === 'zh' || body.lang === 'en') patch.lang = body.lang
    if ((patch.provider || t.settings.provider) === 'chatgpt-subscription') { json(res, 400, { error: { message: 'ChatGPT 订阅线上还没开;用 API key 或 Claude 订阅 / ChatGPT subscription is not available online yet' } }); return true }
    const r = await save(t, ctx, patch)
    if (r.error) { json(res, 500, { error: { message: r.error } }); return true }
    json(res, 200, { ok: true, ready: r.ready, ...r.pub })
    return true
  }

  // Claude 订阅一键登录:各人一个 HOME(<数据根>/users/<owner>/claude-auth),令牌到手存进他的那一行
  if (p === '/claude/status' || p === '/claude/login' || p === '/claude/code') {
    const M = t.marks
    if (!M.claudeAuth) M.claudeAuth = createClaudeAuth({ onToken: (token) => save(t, ctx, { oauthToken: token }) })
    const a = M.claudeAuth
    const connected = () => { const o = t.settings?.oauthToken || ''; return { connected: /^sk-ant-oat/.test(o), hint: o ? `${o.slice(0, 12)}…${o.slice(-4)}` : '' } }
    try {
      if (!t.dataDir) throw new Error('服务器没配数据根目录(FAIRWIND_DATA_DIR)')
      mkdirSync(t.dataDir, { recursive: true })
      if (req.method === 'POST' && p === '/claude/login') json(res, 200, { ...(await a.start(t.dataDir)), ...connected() })
      else if (req.method === 'POST' && p === '/claude/code') { const body = await readJson(req); await a.submitCode(body.code); json(res, 200, { ...a.view(), ...connected() }) }
      else json(res, 200, { ...a.view(), ...connected() })
    } catch (e) { json(res, p === '/claude/status' ? 200 : 400, { ...a.view(), ...connected(), error: { message: e.message } }) }
    return true
  }
  if (p === '/chatgpt/status' || p === '/chatgpt/login') { json(res, p === '/chatgpt/status' ? 200 : 501, { connected: false, error: { message: 'ChatGPT 订阅线上还没开 / not available online yet' } }); return true }

  // 判据文档:库里那个人的几行,页面上的编辑器跟本机版同一套(文件名是键)
  if (req.method === 'GET' && p === '/judgments/files') {
    const { data, error } = await t.db.rpc('pa_judgment_docs')
    if (error) { json(res, 500, { error: error.message }); return true }
    const files = {}
    for (const f of Object.keys(JUDGMENT_FILES)) files[f] = ''
    for (const r of data || []) if (r.name in files) files[r.name] = r.body || ''
    json(res, 200, { dir: '', files })
    return true
  }
  if (req.method === 'POST' && p === '/judgments/files') {
    const body = await readJson(req)
    if (!(body.file in JUDGMENT_FILES)) { json(res, 400, { ok: false, error: `只能写这几个文件:${Object.keys(JUDGMENT_FILES).join('、')}` }); return true }
    const content = String(body.content ?? '')
    const { error } = await t.db.rpc('pa_set_judgment_doc', { p_name: body.file, p_body: content })
    if (error) { json(res, 400, { ok: false, error: error.message }); return true }
    ctx.hosted.invalidate(t.owner)
    json(res, 200, { ok: true, lints: lintJudgments(body.file, content) })
    return true
  }

  // 备份往返(D16):我名下的行 + 桶里 owner/ 底下的附件,一个 zip;本机版同一种包
  if (p === '/backup/export' || p === '/backup/import') {
    return handleBackupRoute(req, res, { db: t.db, owner: t.owner, email: t.email, prefix: t.owner, appVersion: VERSION })
  }

  // 换 MCP 令牌(D13):旧的那串当场作废,桥那一行命令要重贴
  if (req.method === 'POST' && p === '/settings/mcp-token/rotate') {
    const { data, error } = await t.db.rpc('pa_rotate_mcp_token')
    if (error) { json(res, 500, { ok: false, error: error.message }); return true }
    ctx.hosted.invalidate(t.owner)
    t.settings = { ...t.settings, mcpToken: data }
    json(res, 200, { ok: true, mcpToken: data })
    return true
  }

  // 静态:dist/ 里真有的文件才出;/ 回 index.html。别的路径不接——交给 server.js 自己的路由
  if (req.method === 'GET' && ctx.distDir && existsSync(ctx.distDir)) {
    const rel = p === '/' ? 'index.html' : normalize(p).replace(/^\/+/, '')
    const f = resolve(ctx.distDir, rel)
    if (f.startsWith(resolve(ctx.distDir)) && existsSync(f) && !statSync(f).isDirectory()) {
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return true
    }
  }
  return false
}

/** 写那个人的设置:只带传了的键;写完让工厂下次重读;返回页面要的样子 */
async function save(t, ctx, patch) {
  const { error } = await t.db.rpc('pa_set_member_settings', { p: rowFromSettings(patch) })
  if (error) return { error: error.message }
  ctx.hosted.invalidate(t.owner)
  const next = { ...t.settings, ...patch }
  t.settings = next
  return { ready: Boolean(readyOf(next)), pub: publicSettingsOf({ ...next, email: t.email }) }
}
