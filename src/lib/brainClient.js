// src/lib/brainClient.js —— 本机模式下前端的「supa」:同一个表面,底下是 fetch 到 brain。
// 只仿今天代码真用到的那一点(跟 brain/local/localdb.js 同一份清单)。21 个 import supa 的文件一个不改。
const ok = (data) => ({ data, error: null })
const bad = (message) => ({ data: null, error: { message } })

export function brainClient(base, fetchImpl = (...a) => globalThis.fetch(...a)) {
  const post = async (path, body) => {
    try {
      const r = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      return await r.json()
    } catch (e) { return bad(e.message) }
  }

  class From {
    constructor(view) { this.q = { view, select: '*', filters: [], order: [], limit: null, single: null } }
    select(cols = '*') { this.q.select = cols; return this }
    eq(col, v) { this.q.filters.push(['eq', col, v]); return this }
    in(col, arr) { this.q.filters.push(['in', col, arr]); return this }
    order(col, { ascending = true } = {}) { this.q.order.push({ col, ascending }); return this }
    limit(n) { this.q.limit = n; return this }
    maybeSingle() { this.q.single = 'maybe'; return this }
    then(res, rej) { return post('/db/from', this.q).then(res, rej) }
  }

  let me = null
  const whoami = async () => {
    try { const r = await fetchImpl(`${base}/me`); me = await r.json() } catch { me = { ready: false, user: null } }
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
            try { const r = await fetchImpl(`${base}/files/${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': contentType || file?.type || 'application/octet-stream' }, body: file }); return await r.json() } catch (e) { return bad(e.message) }
          },
          async remove(keys) {
            try { for (const k of keys) await fetchImpl(`${base}/files/${encodeURIComponent(k)}`, { method: 'DELETE' }); return ok(keys) } catch (e) { return bad(e.message) }
          },
          async download(key) {
            try { const r = await fetchImpl(`${base}/files/${encodeURIComponent(key)}`); if (!r.ok) return bad(`没有这个文件:${key}`); const buf = await r.arrayBuffer(); return ok({ arrayBuffer: async () => buf }) } catch (e) { return bad(e.message) }
          },
          async createSignedUrl(key) { return ok({ signedUrl: `${base}/files/${encodeURIComponent(key)}` }) },
        }
      },
    },
    auth: {
      async getSession() { const m = await whoami(); return { data: { session: sessionOf(m), local: true }, error: null } },
      async getUser() { const m = await whoami(); return { data: { user: m.user }, error: null } },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } },
      async signOut() { return { error: null } },
      async signInWithPassword() { return { data: null, error: { message: '本机模式没有登录这回事' } } },
      async signUp() { return { data: null, error: { message: '本机模式没有登录这回事' } } },
    },
    /** 首次启动页用 */
    setup: (body) => post('/setup', body),
    /** 「关于你」底下的账号那块用:读到的永远没有 key 本身,只有「设了没有」和末四位 */
    judgments: { preview: (limit = 20) => post('/judgments/preview', { limit }) },
    backup: {
      async list() { try { const r = await fetchImpl(`${base}/backup/list`); return await r.json() } catch (e) { return { dir: '', files: [] } } },
      now: () => post('/backup/now', {}),
      restore: (path) => post('/backup/restore', { path }),
    },
    update: {
      async check(force = false) { try { const r = await fetchImpl(`${base}/update/check${force ? '?force' : ''}`); return await r.json() } catch (e) { return { canUpdate: false, error: e.message } } },
      apply: () => post('/update/apply', {}),
    },
    settings: {
      async get() { try { const r = await fetchImpl(`${base}/settings`); return await r.json() } catch (e) { return null } },
      set: (patch) => post('/settings', patch),
    },
    whoami,
  }
}
