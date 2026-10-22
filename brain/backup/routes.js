// brain/backup/routes.js —— 两条路,本机和托管各自的 routes.js 都接到这里:
//
//   GET  /backup/export          zip 流下来(content-disposition 带日期文件名)
//   POST /backup/import?wipe=1   body 是整个 zip(application/zip);wipe=1 先清我名下的行
//
// 身份由调用方给(本机 = settings.json 里那个人;托管 = 请求上的租户),这里不认人。
import { exportBackup } from './roundtrip.js'
import { importDiskBackup, LIMITS } from './diskImport.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
let importing = false

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
const stamp = (d) => d.toISOString().slice(0, 10)

/**
 * 处理了返回 true;不是这两条路返回 false。
 * @param {object} o  { db, owner, email, prefix, appVersion, now? }
 */
export async function handleBackupRoute(req, res, { db, owner, email, prefix = '', appVersion = '', now = () => new Date() }) {
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname

  if (req.method === 'GET' && p === '/backup/export') {
    // 表先读齐再开始写响应:读表失败还能回一个 JSON 错;附件中途失败只能断流(浏览器会看见下载失败)
    let started = false
    try {
      await exportBackup({ db, owner, email, prefix, appVersion, now, write: async (bytes) => {
        if (!started) { started = true; res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="fairwind-${stamp(now())}.zip"` }) }
        if (!res.write(bytes) && typeof res.once === 'function') await new Promise((ok) => res.once('drain', ok))
      } })
      res.end()
    } catch (e) {
      if (!started) json(res, 500, { ok: false, error: e.message })
      else { console.error('  ✗ 备份导出中途失败:' + e.message); res.destroy?.(e) ?? res.end() }
    }
    return true
  }

  if (req.method === 'POST' && p === '/backup/import') {
    const wipe = ['1', 'true', 'yes'].includes(url.searchParams.get('wipe') || '')
    try {
      if (importing) { json(res, 409, { ok: false, error: '服务器正在导入另一份备份，请完成后再试' }); return true }
      importing = true
      let dir
      try {
        dir = await mkdtemp(join(tmpdir(), 'fairwind-import-'))
        const path = join(dir, 'upload.zip'); let received = 0
        const limit = new Transform({ transform(chunk, enc, cb) { received += chunk.length; cb(received > LIMITS.upload ? new Error('备份文件超过 4GB 限制') : null, chunk) } })
        await pipeline(req, limit, createWriteStream(path, { mode: 0o600 }))
        if (!received) throw new Error('没收到文件')
        json(res, 200, await importDiskBackup({ db, path, dir, wipe, prefix }))
      } finally {
        try { if (dir) await rm(dir, { recursive: true, force: true }) } finally { importing = false }
      }
    } catch (e) { json(res, 400, { ok: false, error: e.message }) }
    return true
  }

  return false
}
