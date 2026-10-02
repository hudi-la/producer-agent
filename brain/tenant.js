// brain/tenant.js —— 「我现在替谁干活」(设计稿 2026-10-02 第六节)。
//
// 脑子以前是单人的:一个 db、key 塞在 process.env、模块开关一个对象。托管以后一个进程伺候
// 所有人,这些东西全部搬进一个**租户上下文**,随请求 / 随任务走:
//
//   tenant()            当前上下文。没有(local / service 配置)就是启动时那个静态的——行为逐字等于以前
//   withTenant(t, fn)   在 t 的身份下跑 fn,里面所有异步调用都自动看到 t(AsyncLocalStorage)
//   envFor(settings)    settings → 模型调用要的 env 对象。**key 不再进 process.env**
//
// hosted 配置下两种来路(makeHosted):
//   fromRequest(req)    浏览器的 JWT → 那个人的 Supabase 客户端(RLS 生效)+ 他的设置/模块/判据
//   forOwner(owner)     后台替某个人干活:用 Auth 管理接口给他造一个会话(不发邮件),缓存着
//   forMcpToken(token)  MCP 桥带来的令牌 → 是谁 → forOwner
import { AsyncLocalStorage } from 'node:async_hooks'
import { join } from 'node:path'

const T = new AsyncLocalStorage()
let STATIC = null

/** local / service 配置:启动时建一次,一辈子不变。 */
export function setStaticTenant(t) { STATIC = t; return t }
export function tenant() {
  const t = T.getStore() || STATIC
  if (!t) throw new Error('没有租户上下文:hosted 配置下这条路没经过 withTenant')
  return t
}
export function currentTenant() { return T.getStore() || STATIC || null }
export function withTenant(t, fn) { return T.run(t, fn) }

/**
 * 「现在的环境」= 进程的 env 盖上租户的 env。models.js / engine/ 的缺省参数都从这儿拿:
 * local 下静态租户的 env 来自 settings.json;service(他自己)下静态租户 env 为空 → 逐字等于以前读 process.env。
 */
export function envNow() {
  const t = T.getStore() || STATIC
  return t?.env ? { ...process.env, ...t.env } : process.env
}

/**
 * settings(跟 settings.json 同形)→ 模型调用要的 env。镜像自原来的 exportEnv,只是**返回对象**而不是写 process.env。
 * 选哪条模型来源就只带哪条的凭据。
 */
export function envFor(s = {}, { dataDir = '' } = {}) {
  const env = {}
  env.FAIRWIND_PROVIDER = s.provider === 'openai' || s.provider === 'gemini' || s.provider === 'chatgpt-subscription' ? s.provider : 'claude'
  if (s.provider === 'claude-subscription') { if (s.oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = s.oauthToken }
  else if (s.provider === 'openai') { if (s.openaiKey) env.OPENAI_API_KEY = s.openaiKey }
  else if (s.provider === 'gemini') { if (s.geminiKey) env.GEMINI_API_KEY = s.geminiKey }
  else if (s.provider !== 'chatgpt-subscription' && s.apiKey) env.ANTHROPIC_API_KEY = s.apiKey
  env.BRAIN_MODEL = s.model || ''
  env.BRAIN_MODEL_CHEAP = s.modelCheap || ''
  env.FAIRWIND_LANG = s.lang === 'en' ? 'en' : 'zh'
  if (dataDir) env.FAIRWIND_DATA_DIR = dataDir
  return env
}

/** 给子进程(SDK 的 claude、Codex)的环境:进程自己的 env 去掉所有凭据,再盖上租户的。 */
const SECRET_KEYS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENAI_BASE_URL', 'GEMINI_BASE_URL', 'ANTHROPIC_BASE_URL']
export function childEnv(t = tenant(), base = process.env) {
  const out = { ...base }
  for (const k of SECRET_KEYS) delete out[k]
  for (const k of ['FAIRWIND_PROVIDER', 'BRAIN_MODEL', 'BRAIN_MODEL_CHEAP', 'FAIRWIND_LANG', 'FAIRWIND_DATA_DIR']) delete out[k]
  return { ...out, ...t.env }
}

/** member_settings 那一行(库里 snake_case)→ settings 对象(跟 settings.json 同形)。 */
export function settingsFromRow(r = {}) {
  return {
    provider: r.provider || 'claude-key', apiKey: r.api_key || '', oauthToken: r.oauth_token || '', openaiKey: r.openai_key || '', geminiKey: r.gemini_key || '',
    model: r.model || '', modelCheap: r.model_cheap || '', lang: r.lang === 'en' ? 'en' : 'zh', judgmentsEnabled: r.judgments_enabled !== false,
    modules: r.modules || null, mcpToken: r.mcp_token || '', email: r.email || '',
  }
}

/** settings 对象 → pa_set_member_settings 要的 jsonb(只带传了的键)。 */
export function rowFromSettings(patch = {}) {
  const map = { provider: 'provider', apiKey: 'api_key', oauthToken: 'oauth_token', openaiKey: 'openai_key', geminiKey: 'gemini_key', model: 'model', modelCheap: 'model_cheap', lang: 'lang', judgmentsEnabled: 'judgments_enabled', modules: 'modules' }
  const out = {}
  for (const [k, col] of Object.entries(map)) if (patch[k] !== undefined) out[col] = patch[k]
  return out
}

/** 模块开关:hosted 下从那一行来;邮件在线上第一期不开(D9)。 */
export function modulesFor(s) {
  const m = { profile: true, pursuits: true, mail: false, ...(s.modules || {}) }
  return { ...m, profile: true, mail: false, canToggle: true, mailOffered: false }
}

/** Authorization: Bearer xxx → xxx;没有就 null。 */
export function parseBearer(req) {
  const h = req?.headers?.authorization || req?.headers?.Authorization || ''
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1].trim() : null
}

/** JWT 的 payload(不验签——验签是 Supabase 的事,这里只看 exp 和 sub 用来做缓存)。 */
export function jwtPayload(jwt) {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) } catch { return null }
}

/**
 * hosted 配置的工厂。依赖全部注入,方便测试:
 *   createClient(url, key, opts)  supabase-js 的
 *   service                       service_role 客户端(只用来找活、查人、造会话)
 *   loadSettings(db)              → settings 对象(缺省 rpc pa_member_secrets)
 *   loadJudgments(db)             → { docs }   (缺省 rpc pa_judgment_docs → 文件名→事件名 的映射由调用方给)
 *   now()                         时间,测试用
 */
export function makeHosted({ url, anon, service, createClient, dataRoot = '', ttlMs = 60_000, now = () => Date.now(),
                             loadSettings = defaultLoadSettings, loadJudgments = defaultLoadJudgments, docsFromRows = (rows) => ({ docs: {}, rows }),
                             lookupMcpToken = defaultLookupMcpToken, log = () => {} }) {
  const settingsCache = new Map()    // owner → { at, settings, judgments }
  const sessionCache = new Map()     // owner → { db, email }
  const jwtCache = new Map()         // jwt → { owner, email, exp }
  const marks = new Map()            // owner → 进程级标记(忙碌、缓存)按人分开

  const marksOf = (owner) => { if (!marks.has(owner)) marks.set(owner, {}); return marks.get(owner) }

  async function hydrate(owner, db, email) {
    const hit = settingsCache.get(owner)
    let settings, judgments
    if (hit && now() - hit.at < ttlMs) ({ settings, judgments } = hit)
    else {
      settings = await loadSettings(db)
      judgments = docsFromRows(await loadJudgments(db))
      settingsCache.set(owner, { at: now(), settings, judgments })
    }
    const dataDir = dataRoot ? join(dataRoot, 'users', owner) : ''
    return { mode: 'hosted', owner, email: email || settings.email || '', db, settings, env: envFor(settings, { dataDir }), dataDir,
             modules: modulesFor(settings), judgments: { docs: judgments.docs || {}, enabled: settings.judgmentsEnabled !== false }, marks: marksOf(owner) }
  }

  /** 浏览器带来的 JWT → 租户。认不出 → null(调用方回 401)。 */
  async function fromRequest(req) {
    const jwt = parseBearer(req)
    if (!jwt) return null
    let who = jwtCache.get(jwt)
    if (!who || who.exp * 1000 <= now()) {
      const db0 = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } })
      const { data, error } = await db0.auth.getUser(jwt)
      if (error || !data?.user) return null
      const p = jwtPayload(jwt) || {}
      who = { owner: data.user.id, email: data.user.email || '', exp: p.exp || Math.floor(now() / 1000) + 300 }
      jwtCache.set(jwt, who)
      if (jwtCache.size > 500) jwtCache.delete(jwtCache.keys().next().value)
    }
    const db = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } })
    return hydrate(who.owner, db, who.email)
  }

  /** 后台替 owner 干活:造一个他的会话(不发邮件),缓存。 */
  async function forOwner(owner) {
    let s = sessionCache.get(owner)
    if (!s) {
      const { data: u, error: e1 } = await service.auth.admin.getUserById(owner)
      if (e1 || !u?.user?.email) throw new Error(`找不到这个账号:${owner}${e1 ? ':' + e1.message : ''}`)
      const { data: link, error: e2 } = await service.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
      if (e2) throw new Error(`替 ${u.user.email} 造会话失败:${e2.message}`)
      const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: true } })
      const { error: e3 } = await db.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
      if (e3) throw new Error(`替 ${u.user.email} 换会话失败:${e3.message}`)
      s = { db, email: u.user.email }
      sessionCache.set(owner, s)
      log(`  · 替 ${u.user.email} 建了会话`)
    }
    return hydrate(owner, s.db, s.email)
  }

  async function forMcpToken(token) {
    if (!token) return null
    const owner = await lookupMcpToken(service, token)
    return owner ? forOwner(owner) : null
  }

  /** 设置改了:下次读重新拉。会话坏了(401):丢掉重造。 */
  function invalidate(owner, { session = false } = {}) { settingsCache.delete(owner); if (session) sessionCache.delete(owner) }

  return { fromRequest, forOwner, forMcpToken, invalidate, _caches: { settingsCache, sessionCache, jwtCache } }
}

async function defaultLoadSettings(db) {
  const { data, error } = await db.rpc('pa_member_secrets')
  if (error) throw new Error('读不到你的设置:' + error.message)
  const row = Array.isArray(data) ? data[0] : data
  return settingsFromRow(row || {})
}
async function defaultLoadJudgments(db) {
  const { data, error } = await db.rpc('pa_judgment_docs')
  if (error) throw new Error('读不到判据文档:' + error.message)
  return data || []
}
async function defaultLookupMcpToken(service, token) {
  const { data, error } = await service.rpc('pa_owner_of_mcp_token', { p_token: token })
  if (error) throw new Error('查 MCP 令牌失败:' + error.message)
  return data || null
}
