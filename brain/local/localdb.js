// brain/local/localdb.js —— 仿 supabase-js 表面的适配对象,底下是 PGlite。
//
// 只仿今天代码真用到的那一点(2026-09-16 实测):
//   .rpc(name, args)
//   .from(view).select().eq().in().order().limit().maybeSingle()   可 await
//   .storage.from(bucket).upload/download/remove/createSignedUrl
//   .auth.getUser()
// 返回形状跟 supabase-js 一样:{ data, error },绝不抛。
// 不做通用 PostgREST。多一个方法就多一处要对拍的地方。
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { join, normalize, resolve, dirname } from 'node:path'

const ok = (data) => ({ data, error: null })
const bad = (message) => ({ data: null, error: { message } })
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const COLS = /^[a-zA-Z0-9_,\s*]+$/

// PostgREST 对返回值的整形规矩:
//   setof 标量 → [v, v]      setof 复合/table → [{}, {}]
//   标量 → v                  json/jsonb → 解析后的值(PGlite 已解析;没解析的这里补)
//   void → null
const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v)
function shape(fn, rows) {
  if (fn.rettype === 'void') return null
  const one = (r) => { const v = Object.values(r)[0]; return fn.json ? parseJson(v) : v }
  if (fn.retset) return fn.scalar ? rows.map(one) : rows
  if (!rows.length) return null
  return fn.scalar ? one(rows[0]) : rows[0]
}

async function loadFunctions(pg) {
  const { rows } = await pg.query(`
    select p.proname as name, p.proretset as retset, t.typname as rettype, t.typtype as typtype,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and p.proname like 'pa\\_%'`)
  const byName = new Map()
  for (const r of rows) {
    // "p_a uuid, p_b text" → [{name, type}];identity arguments 不含默认值,正好
    const args = r.args ? r.args.split(', ').map((s) => { const i = s.lastIndexOf(' '); return { name: s.slice(0, i), type: s.slice(i + 1) } }) : []
    // 标量 = 非复合、非 record、非 void。json/jsonb 也算标量(一格值)
    const scalar = r.typtype !== 'c' && r.rettype !== 'record' && r.rettype !== 'void'
    if (!byName.has(r.name)) byName.set(r.name, [])
    byName.get(r.name).push({ name: r.name, args, retset: r.retset, rettype: r.rettype, scalar, json: r.rettype === 'json' || r.rettype === 'jsonb' })
  }
  return byName
}

function pickOverload(cands, given) {
  const keys = Object.keys(given)
  // 参数名能盖住调用方给的全部键的那个;多个就取参数最少的
  const fit = cands.filter((f) => keys.every((k) => f.args.some((a) => a.name === k)))
  return fit.sort((a, b) => a.args.length - b.args.length)[0] || null
}

class FromBuilder {
  constructor(pg, view) { this.pg = pg; this.view = view; this.cols = '*'; this.filters = []; this.orders = []; this.lim = null; this.single = false; this.err = null }
  select(cols = '*') { if (!COLS.test(cols)) this.err = `列名只许字母数字下划线逗号空格:${cols}`; else this.cols = cols; return this }
  eq(col, v) { if (!IDENT.test(col)) this.err = `列名不合法:${col}`; this.filters.push({ op: 'eq', col, v }); return this }
  in(col, arr) { if (!IDENT.test(col)) this.err = `列名不合法:${col}`; this.filters.push({ op: 'in', col, v: arr }); return this }
  order(col, { ascending = true } = {}) { if (!IDENT.test(col)) this.err = `列名不合法:${col}`; this.orders.push({ col, ascending }); return this }
  limit(n) { this.lim = Number(n); return this }
  maybeSingle() { this.single = true; return this }
  toSQL() {
    const values = []
    const where = this.filters.map((f) => { values.push(f.v); return f.op === 'eq' ? `${f.col} = $${values.length}` : `${f.col} = any($${values.length})` })
    let text = `select ${this.cols} from public.${this.view}`
    if (where.length) text += ` where ${where.join(' and ')}`
    if (this.orders.length) text += ` order by ${this.orders.map((o) => `${o.col} ${o.ascending ? 'asc' : 'desc'}`).join(', ')}`
    if (this.lim != null) text += ` limit ${this.lim}`
    return { text, values }
  }
  async run() {
    if (this.err) return bad(this.err)
    if (!IDENT.test(this.view)) return bad(`视图名不合法:${this.view}`)
    try {
      const { text, values } = this.toSQL()
      const { rows } = await this.pg.query(text, values)
      return ok(this.single ? (rows[0] ?? null) : rows)
    } catch (e) { return bad(e.message) }
  }
  then(res, rej) { return this.run().then(res, rej) }
}

function makeStorage(dataDir, brainUrl) {
  const root = resolve(dataDir, 'files')
  mkdirSync(root, { recursive: true })
  const pathOf = (key) => {
    const p = resolve(root, normalize(key))
    if (!p.startsWith(root + '/')) throw new Error(`key 不合法:${key}`)
    return p
  }
  return {
    from() {
      return {
        async upload(key, bytes, { contentType } = {}) {
          try {
            const p = pathOf(key); mkdirSync(dirname(p), { recursive: true })
            writeFileSync(p, Buffer.isBuffer(bytes) ? bytes : Buffer.from(await new Response(bytes).arrayBuffer()))
            if (contentType) writeFileSync(p + '.type', contentType)
            return ok({ path: key })
          } catch (e) { return bad(e.message) }
        },
        async download(key) {
          try {
            const p = pathOf(key); if (!existsSync(p)) return bad(`没有这个文件:${key}`)
            const buf = readFileSync(p)
            return ok({ arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), size: buf.length })
          } catch (e) { return bad(e.message) }
        },
        async remove(keys) {
          try { for (const k of keys) { const p = pathOf(k); if (existsSync(p)) unlinkSync(p); if (existsSync(p + '.type')) unlinkSync(p + '.type') } return ok(keys) }
          catch (e) { return bad(e.message) }
        },
        async createSignedUrl(key) {
          try { pathOf(key); return ok({ signedUrl: `${brainUrl}/files/${encodeURIComponent(key)}` }) } catch (e) { return bad(e.message) }
        },
        contentTypeOf(key) { const p = pathOf(key) + '.type'; return existsSync(p) ? readFileSync(p, 'utf8') : 'application/octet-stream' },
      }
    },
  }
}

/**
 * @param {object} o
 * @param {import('@electric-sql/pglite').PGlite} o.pg
 * @param {string} o.dataDir   数据目录(files/ 在它底下)
 * @param {{id:string,email:string}} o.user  本机那个人
 * @param {string} [o.brainUrl]  签名 URL 的前缀
 */
export async function makeLocalDb({ pg, dataDir, user, brainUrl = 'http://localhost:8788' }) {
  let fns = await loadFunctions(pg)
  const me = { ...user }
  const db = {
    mode: 'local',
    async refreshFunctions() { fns = await loadFunctions(pg) },
    setUser(u) { Object.assign(me, u) },
    async rpc(name, args = {}) {
      const cands = fns.get(name)
      if (!cands) return bad(`没有这个函数:${name}`)
      const fn = pickOverload(cands, args)
      if (!fn) return bad(`${name} 的参数对不上:${Object.keys(args).join(',')}`)
      const values = []
      const named = fn.args.filter((a) => a.name in args).map((a) => { values.push(args[a.name]); return `${a.name} => $${values.length}::${a.type}` })
      try {
        const { rows } = await pg.query(`select * from public.${name}(${named.join(', ')})`, values)
        return ok(shape(fn, rows))
      } catch (e) { return bad(`${name}:${e.message}`) }
    },
    from(view) { return new FromBuilder(pg, view) },
    storage: makeStorage(dataDir, brainUrl),
    auth: { async getUser() { return ok({ user: { id: me.id, email: me.email } }) } },
  }
  return db
}
