// src/lib/brainClient.js —— 本机模式下前端的「supa」:同一个表面,底下是 fetch 到 brain。
// 只仿今天代码真用到的那一点(跟 brain/local/localdb.js 同一份清单)。21 个 import supa 的文件一个不改。
import { t } from '../i18n/index.js'
import { errorText } from './userError.js'

const ok = (data) => ({ data, error: null })
const bad = (error) => ({ data: null, ok: false, error: { message: errorText(error), ...(error?.status ? { status: error.status } : {}) } })

export function brainClient(base, fetchImpl = (...a) => globalThis.fetch(...a)) {
  // Keep the existing result contract, but never turn failed reads into empty data.
  const request = async (path, init = {}, binary = false) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), /backup|files|judgments\/preview/.test(path) ? 180000 : 30000)
    try {
      const r = await fetchImpl(`${base}${path}`, { ...init, signal: controller.signal })
      if (binary && r.ok) return await r.blob()
      let body
      try { body = await r.json() } catch { return bad({ message: `HTTP ${r.status}: invalid response`, status: r.status }) }
      if (body === null || typeof body !== 'object') return bad({ message: `HTTP ${r.status}: invalid response`, status: r.status })
      const requestId = r.headers?.get?.('x-fairwind-request-id')
      if (!r.ok || body?.error || body?.ok === false) return bad({ message: `${!r.ok ? `HTTP ${r.status}: ` : ''}${errorText(body?.error) || 'Operation failed'}${/^[0-9a-f-]{36}$/i.test(requestId || '') ? ` [request:${requestId}]` : ''}`, status: r.status })
      return body
    } catch (e) { return bad(e?.name === 'AbortError' ? 'Request timed out' : e) }
    finally { clearTimeout(timeout) }
  }
  const post = (path, body) => request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  class From {
    constructor(view) { this.q = { view, select: '*', filters: [], order: [], limit: null, single: null, count: null, head: false } }
    select(cols = '*', { count = null, head = false } = {}) { this.q.select = cols; this.q.count = count; this.q.head = head; return this }
    is(col, v) { this.q.filters.push(['is', col, v]); return this }
    or(expr) { this.q.filters.push(['or', expr, null]); return this }
    eq(col, v) { this.q.filters.push(['eq', col, v]); return this }
    in(col, arr) { this.q.filters.push(['in', col, arr]); return this }
    order(col, { ascending = true } = {}) { this.q.order.push({ col, ascending }); return this }
    limit(n) { this.q.limit = n; return this }
    maybeSingle() { this.q.single = 'maybe'; return this }
    then(res, rej) { return post('/db/from', this.q).then(res, rej) }
  }

  let me = null
  const whoami = async () => {
    me = await request('/me')
    return me
  }
  const sessionOf = (m) => (m.ready && m.user ? { user: m.user, local: true } : null)

  return {
    mode: 'local',
    from: (view) => new From(view),
    rpc: (name, args = {}) => post(`/db/rpc/${name}`, args),
    storage: {
      from() {
        return {
          async upload(key, file, { contentType } = {}) {
            return request(`/files/${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': contentType || file?.type || 'application/octet-stream' }, body: file })
          },
          async remove(keys) {
            for (const k of keys) { const r = await request(`/files/${encodeURIComponent(k)}`, { method: 'DELETE' }); if (r.error) return r }; return ok(keys)
          },
          async download(key) {
            try { const r = await fetchImpl(`${base}/files/${encodeURIComponent(key)}`); if (!r.ok) return bad(`HTTP ${r.status}: ${t('没有这个文件:{key}', { key })}`); const buf = await r.arrayBuffer(); return ok({ arrayBuffer: async () => buf }) } catch (e) { return bad(e.message) }
          },
          async createSignedUrl(key) { return ok({ signedUrl: `${base}/files/${encodeURIComponent(key)}` }) },
        }
      },
    },
    auth: {
      async getSession() { const m = await whoami(); return { data: { session: sessionOf(m), local: true, lang: m.lang || 'zh' }, error: m.error || null } },
      async getUser() { const m = await whoami(); return { data: { user: m.user }, error: m.error || null } },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } },
      async signOut() { return { error: null } },
      async signInWithPassword() { return { data: null, error: { message: t('本机模式没有登录这回事') } } },
      async signUp() { return { data: null, error: { message: t('本机模式没有登录这回事') } } },
    },
    /** 首次启动页用 */
    claude: {
      async status() { return request(`/claude/status`) },
      login: () => post('/claude/login', {}),
      code: (code) => post('/claude/code', { code }),
    },
    chatgpt: {
      async status() { return request(`/chatgpt/status`) },
      login: () => post('/chatgpt/login', {}),
    },
    setup: (body) => post('/setup', body),
    /** 「关于你」底下的账号那块用:读到的永远没有 key 本身,只有「设了没有」和末四位 */
    judgments: {
      preview: (limit = 20) => post('/judgments/preview', { limit }),
      async files() { return request(`/judgments/files`) },
      write: (file, content) => post('/judgments/files', { file, content }),
    },
    backup: {
      async list() { return request(`/backup/list`) },
      now: () => post('/backup/now', {}),
      restore: (path) => post('/backup/restore', { path }),
      // 一种备份两边通(2026-10-02):我名下所有行 + 附件打成一个 zip;导入同样的 zip。本机、托管同一对口
      async export() { const r = await request('/backup/export', {}, true); if (r.error) throw Object.assign(new Error(r.error.message), r.error); return r },
      async import(file, { wipe = true } = {}) { return request(`/backup/import${wipe ? '?wipe=1' : ''}`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: file }) },
    },
    update: {
      async check(force = false) { return request(`/update/check${force ? '?force' : ''}`) },
      apply: () => post('/update/apply', {}),
    },
    quit: () => post('/quit', {}),
    mcpTargets: {
      async list() { return request(`/mcp/targets`) },
      install: (target) => post('/mcp/targets', { target }),
    },
    settings: {
      async get() { return request(`/settings`) },
      set: (patch) => post('/settings', patch),
      rotateMcpToken: () => post('/settings/mcp-token/rotate', {}),
    },
    whoami,
  }
}
