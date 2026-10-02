// brain/backup/roundtrip.js —— 「下载我的备份」和「用备份恢复」的本体,本机和托管同一份(设计稿 2026-10-02 D16、第十一节)。
//
// 包的样子(zip):
//   manifest.json        { format, version, exported_at, owner, email, app_version, tables: [表名], files: [{key, type, size}] }
//   tables/<表>.json     pa_backup_export 给的那张表的整行数组(只有我的行,RLS 管的)
//   files/<key>          附件,key 原样做路径(托管下 key 以 owner/ 开头;本机是 files/ 文件夹里的相对路径)
//
// 本机版原来的 tar.gz(local/backup.js)是整库 dump,留作机器级备份;页面上露的是这一种,两边通。
// 表的读写全在库里(0157 的两个函数),这里只管打包、拆包、搬文件——所以本机 PGlite 和线上 Supabase 走的是同一段代码。
import { ZipWriter, readZip } from './zip.js'

export const FORMAT = 'fairwind-backup'
export const VERSION = 1
const KNOWN_VERSIONS = new Set([1])
export const BUCKET = 'pursuit-files'

/** 桶里 prefix 底下的所有文件(递归;supabase 的 list 只列一层,文件夹 id 为 null)。返回 [{ key, type, size }]。 */
export async function listAllFiles(bucket, prefix = '') {
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(prefix, { limit: 1000, offset })
    if (error) throw new Error(`列附件 ${prefix || '/'} 失败:${error.message}`)
    for (const e of data || []) {
      const key = prefix ? `${prefix}/${e.name}` : e.name
      if (e.id == null) out.push(...await listAllFiles(bucket, key))
      else out.push({ key, type: e.metadata?.mimetype || 'application/octet-stream', size: e.metadata?.size ?? null })
    }
    if (!data || data.length < 1000) return out
  }
}

/**
 * 导出:把包一段一段交给 write(bytes)。边读边写,附件多也不用整包攒在内存里。
 * @param {object} o
 * @param {object} o.db       supabase-js 同形的客户端(本机是 localdb 的适配)
 * @param {string} o.owner    我的 uid
 * @param {string} o.email
 * @param {string} o.prefix   桶里我的那一段(托管 = owner;本机 = '' 整个文件夹)
 * @param {string} o.appVersion
 * @param {(bytes: Buffer) => Promise<void>|void} o.write
 * @param {() => Date} [o.now]
 */
export async function exportBackup({ db, owner, email, prefix = '', appVersion = '', write, now = () => new Date() }) {
  const { data: tables, error } = await db.rpc('pa_backup_export')
  if (error) throw new Error('读表失败:' + error.message)
  const bucket = db.storage.from(BUCKET)
  const files = await listAllFiles(bucket, prefix)
  const w = new ZipWriter({ now })
  const manifest = { format: FORMAT, version: VERSION, exported_at: now().toISOString(), owner, email: email || '', app_version: appVersion,
                     tables: Object.keys(tables || {}), files }
  await write(w.add('manifest.json', JSON.stringify(manifest, null, 2), { deflate: true }))
  for (const [name, rows] of Object.entries(tables || {})) await write(w.add(`tables/${name}.json`, JSON.stringify(rows), { deflate: true }))
  for (const f of files) {
    const { data, error: e } = await bucket.download(f.key)
    if (e) throw new Error(`下载附件 ${f.key} 失败:${e.message}`)
    await write(w.add(`files/${f.key}`, Buffer.from(await data.arrayBuffer())))
  }
  await write(w.finish())
  return { tables: Object.fromEntries(Object.entries(tables || {}).map(([k, v]) => [k, v.length])), files: files.length, manifest }
}

/** 拆包:认格式、认版本,把表和文件分出来。坏包、不认识的版本当场报。 */
export function parseBackup(bytes) {
  const entries = readZip(bytes)
  const m = entries.find((e) => e.name === 'manifest.json')
  if (!m) throw new Error('这不是 Fairwind 的备份包(没有 manifest.json)')
  let manifest
  try { manifest = JSON.parse(m.data.toString('utf8')) } catch { throw new Error('manifest.json 不是合法的 JSON') }
  if (manifest.format !== FORMAT) throw new Error(`这不是 Fairwind 的备份包(format=${manifest.format})`)
  if (!KNOWN_VERSIONS.has(manifest.version)) throw new Error(`备份包版本 ${manifest.version} 不认识;这个版本的 Fairwind 只认 ${[...KNOWN_VERSIONS].join('、')}`)
  const tables = {}
  const files = []
  for (const e of entries) {
    if (e.name.startsWith('tables/') && e.name.endsWith('.json')) {
      const name = e.name.slice('tables/'.length, -'.json'.length)
      try { tables[name] = JSON.parse(e.data.toString('utf8')) } catch { throw new Error(`tables/${name}.json 不是合法的 JSON`) }
    } else if (e.name.startsWith('files/') && e.name.length > 'files/'.length) {
      files.push({ key: e.name.slice('files/'.length), data: e.data })
    }
  }
  const types = new Map((manifest.files || []).map((f) => [f.key, f.type]))
  for (const f of files) f.type = types.get(f.key) || 'application/octet-stream'
  return { manifest, tables, files }
}

/**
 * 导入:表走 pa_backup_import(一个事务),附件逐个传回桶(同名覆盖)。
 * 返回 { ok, tables: {表: 行数}, wiped: {表: 行数}, files: 传成功的个数, failed: [{key, error}] }。
 * 附件传不上(托管下 key 不以我的 owner 开头会被桶策略拦)不算整体失败——表已经进去了,缺哪几个文件照实报。
 */
/**
 * 附件 key 换主人。托管的 key 以 <owner>/ 开头(0153 的桶策略只认自己那一段),本机的没有前缀。
 * 包里记着是谁导出的(manifest.owner):以他开头的那一段换成新主人;没有那一段(本机包)就加上。
 * 导进本机(prefix 空)不动——本机的文件夹不在乎前缀。表里两处 key(attachments.storage_key、
 * works.box.files[].key)和文件本身一起换,不然导进去自己也看不见。
 */
export function rekey(key, { from, to }) {
  if (!to || typeof key !== 'string' || !key) return key
  if (key.startsWith(`${to}/`)) return key
  if (from && key.startsWith(`${from}/`)) return `${to}/${key.slice(from.length + 1)}`
  return `${to}/${key}`
}
function rekeyTables(tables, opt) {
  if (!opt.to) return tables
  const out = { ...tables }
  if (Array.isArray(out.attachments)) out.attachments = out.attachments.map((r) => ({ ...r, storage_key: rekey(r.storage_key, opt) }))
  if (Array.isArray(out.works)) out.works = out.works.map((r) => {
    const files = r.box?.files
    return Array.isArray(files) ? { ...r, box: { ...r.box, files: files.map((f) => ({ ...f, key: rekey(f.key, opt) })) } } : r
  })
  return out
}

export async function importBackup({ db, bytes, wipe = false, prefix = '' }) {
  const parsed = parseBackup(bytes)
  const { manifest } = parsed
  const opt = { from: manifest.owner || '', to: prefix || '' }
  const tables = rekeyTables(parsed.tables, opt)
  const files = parsed.files.map((f) => ({ ...f, key: rekey(f.key, opt) }))
  const { data, error } = await db.rpc('pa_backup_import', { p: tables, p_wipe: Boolean(wipe) })
  if (error) throw new Error('写表失败:' + error.message)
  const bucket = db.storage.from(BUCKET)
  let n = 0
  const failed = []
  for (const f of files) {
    const { error: e } = await bucket.upload(f.key, f.data, { contentType: f.type, upsert: true })
    if (e) failed.push({ key: f.key, error: e.message }); else n++
  }
  return { ok: true, manifest: { exported_at: manifest.exported_at, owner: manifest.owner, email: manifest.email, app_version: manifest.app_version },
           tables: data?.tables || {}, wiped: data?.wiped || {}, files: n, failed }
}
