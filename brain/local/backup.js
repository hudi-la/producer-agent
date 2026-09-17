// brain/local/backup.js —— 本地库的备份与恢复。
//
// 备份 = 把整个 PGlite 数据目录 dump 成一个 tar.gz,写进学员自己选的文件夹
// (选在 iCloud Drive / Google Drive 里,备份就自动上了他自己的云,作者一个字节不经手)。
// 恢复 = 把文件放到 <数据目录>/restore.tar.gz,下次启动 openLocalDb 看见它就换库
// (现在的库先改名留着,不删——「绝不丢信息」)。
import { PGlite } from '@electric-sql/pglite'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, unlinkSync, renameSync, copyFileSync } from 'node:fs'
import { join, basename } from 'node:path'

export const KEEP = 14
const NAME = /^fairwind-\d{4}-\d{2}-\d{2}-\d{4}\.tar\.gz$/

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 现在备份一份到 dir。返回文件路径。 */
export async function backupNow(pg, dir, { now = new Date() } = {}) {
  if (!dir) throw new Error('还没选备份目录')
  mkdirSync(dir, { recursive: true })
  const blob = await pg.dumpDataDir('gzip')
  const file = join(dir, `fairwind-${stamp(now)}.tar.gz`)
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()))
  prune(dir)
  return file
}

/** 只留最近 KEEP 份。 */
export function prune(dir, keep = KEEP) {
  const all = listBackups(dir)
  for (const b of all.slice(keep)) unlinkSync(b.path)
  return all.slice(0, keep)
}

/** 备份目录里的文件,新的在前。 */
export function listBackups(dir) {
  if (!dir || !existsSync(dir)) return []
  return readdirSync(dir).filter((f) => NAME.test(f))
    .map((f) => ({ name: f, path: join(dir, f), size: statSync(join(dir, f)).size }))
    .sort((a, b) => (a.name < b.name ? 1 : -1))
}

/** 把一份备份排进「下次启动时恢复」。文件先拷进数据目录,原件不动。 */
export function scheduleRestore(dataDir, file) {
  if (!file || !existsSync(file)) throw new Error(`没有这个文件:${file}`)
  if (!basename(file).endsWith('.tar.gz')) throw new Error('备份文件该是 .tar.gz')
  copyFileSync(file, join(dataDir, 'restore.tar.gz'))
  return join(dataDir, 'restore.tar.gz')
}

export const RESTORE_FILE = (dataDir) => join(dataDir, 'restore.tar.gz')

/**
 * 启动时调:有 restore.tar.gz 就用它换库。现在的 db/ 改名成 db.bak-<时间>,不删。
 * 返回 { pg, restored: boolean, kept?: string }。没有标记就照常开。
 */
export async function openWithRestore(dataDir) {
  const dbDir = join(dataDir, 'db')
  const marker = RESTORE_FILE(dataDir)
  if (!existsSync(marker)) return { pg: new PGlite(dbDir), restored: false }
  const bytes = readFileSync(marker)
  let kept = null
  if (existsSync(dbDir)) { kept = `${dbDir}.bak-${stamp()}`; renameSync(dbDir, kept) }
  try {
    const pg = new PGlite(dbDir, { loadDataDir: new Blob([bytes]) })
    await pg.waitReady
    unlinkSync(marker)
    return { pg, restored: true, kept }
  } catch (err) {
    // 恢复失败:把原来的放回去,标记留着让人看见,错误往上抛
    if (kept && existsSync(kept) && !existsSync(dbDir)) renameSync(kept, dbDir)
    throw new Error(`从备份恢复失败:${err.message}(原来的库没动)`)
  }
}
