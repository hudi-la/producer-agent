// Large imports spool to private disk. Validate every entry before any database mutation.
import { open, readFile } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Transform, Readable } from 'node:stream'
import { createInflateRaw } from 'node:zlib'
import { join } from 'node:path'
import { uploadFile } from './uploadFile.js'
import { BUCKET, FORMAT, rekey, rekeyTables } from './roundtrip.js'

const TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLE[i] = c >>> 0 }
export const LIMITS = { upload: 4 * 1024 ** 3, expanded: 8 * 1024 ** 3, json: 32 * 1024 ** 2 }
const safeName = (n) => n && !n.startsWith('/') && !n.includes('\\') && !n.split('/').some(p => p === '..' || p === '.')

export async function extractZip(path, dir, limits = LIMITS) {
  const f = await open(path, 'r')
  try {
    const size = (await f.stat()).size
    const read = async (at, n) => {
      if (at < 0 || n < 0 || at + n > size) throw new Error('备份 ZIP 文件不完整')
      const b = Buffer.alloc(n); const { bytesRead } = await f.read(b, 0, n, at)
      if (bytesRead !== n) throw new Error('备份 ZIP 文件不完整'); return b
    }
    const tail = await read(Math.max(0, size - 65557), Math.min(size, 65557))
    let e = -1
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { e = i; break }
    if (e < 0) throw new Error('不是完整的 zip 备份')
    const count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12)
    let p = tail.readUInt32LE(e + 16)
    const end = p + cdSize
    if (tail.readUInt16LE(e + 4) || tail.readUInt16LE(e + 6) || count === 65535 || p === 0xffffffff || end > size - tail.length + e) throw new Error('暂不支持分卷或 ZIP64 备份')
    const entries = [], names = new Set(); let total = 0, jsonBytes = 0
    for (let i = 0; i < count; i++) {
      const h = await read(p, 46)
      if (h.readUInt32LE(0) !== 0x02014b50) throw new Error('ZIP 中央目录损坏')
      const flags = h.readUInt16LE(8), method = h.readUInt16LE(10), crc = h.readUInt32LE(16), cs = h.readUInt32LE(20), us = h.readUInt32LE(24), off = h.readUInt32LE(42)
      const nl = h.readUInt16LE(28), xl = h.readUInt16LE(30), cl = h.readUInt16LE(32)
      const name = (await read(p + 46, nl)).toString('utf8'); p += 46 + nl + xl + cl
      if (p > end || !safeName(name) || names.has(name) || flags & 1 || ![0, 8].includes(method)) throw new Error('ZIP 含重复、加密或不支持的条目')
      names.add(name); total += us
      if (total > limits.expanded) throw new Error('备份解压后超过安全容量限制')
      if (name === 'manifest.json' || name.startsWith('tables/')) jsonBytes += us
      if (jsonBytes > limits.json) throw new Error('备份中的数据库 JSON 超过 32MB，请分开迁移数据')
      const local = await read(off, 30)
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP 本地头损坏')
      const start = off + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
      if (start + cs > end - cdSize) throw new Error('ZIP 条目越界')
      const file = join(dir, `entry-${i}`); let bytes = 0, sum = 0xffffffff
      const check = new Transform({ transform(chunk, enc, cb) {
        bytes += chunk.length
        if (bytes > us) return cb(new Error('ZIP 解压大小异常'))
        for (const b of chunk) sum = TABLE[(sum ^ b) & 255] ^ (sum >>> 8)
        cb(null, chunk)
      } })
      const input = cs ? createReadStream(path, { start, end: start + cs - 1 }) : Readable.from([])
      await pipeline(input, ...(method === 8 ? [createInflateRaw()] : []), check, createWriteStream(file, { mode: 0o600 }))
      if (bytes !== us || ((sum ^ 0xffffffff) >>> 0) !== crc) throw new Error('ZIP 校验失败，尚未修改数据库')
      if (!name.endsWith('/')) entries.push({ name, file })
    }
    return entries
  } finally { await f.close() }
}

export async function importDiskBackup({ db, path, dir, wipe, prefix = '', limits = LIMITS }) {
  const entries = await extractZip(path, dir, limits)
  const m = entries.find(e => e.name === 'manifest.json')
  if (!m) throw new Error('这不是 Fairwind 的备份包(没有 manifest.json)')
  const manifest = JSON.parse(await readFile(m.file, 'utf8'))
  if (manifest.format !== FORMAT) throw new Error('这不是 Fairwind 的备份包')
  if (manifest.version !== 1) throw new Error(`备份包版本 ${manifest.version} 不认识`)
  const tables = {}, files = []
  for (const e of entries) {
    if (e.name.startsWith('tables/') && e.name.endsWith('.json')) tables[e.name.slice(7, -5)] = JSON.parse(await readFile(e.file, 'utf8'))
    else if (e.name.startsWith('files/')) files.push({ ...e, key: e.name.slice(6) })
  }
  const opt = { from: manifest.owner || '', to: prefix }
  const { data, error } = await db.rpc('pa_backup_import', { p: rekeyTables(tables, opt), p_wipe: Boolean(wipe) })
  if (error) throw new Error('写表失败:' + error.message)
  const types = new Map((manifest.files || []).map(f => [f.key, f.type]))
  let n = 0; const failed = []
  for (const f of files) {
    const key = rekey(f.key, opt)
    try {
      const type = types.get(f.key) || 'application/octet-stream'
      await uploadFile(db.storage.from(BUCKET), key, f.file, type)
      n++
    } catch (e) { failed.push({ key, error: e.message }) }
  }
  return { ok: true, manifest: { exported_at: manifest.exported_at, owner: manifest.owner, email: manifest.email, app_version: manifest.app_version }, tables: data?.tables || {}, wiped: data?.wiped || {}, files: n, failed }
}
