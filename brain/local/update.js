// brain/local/update.js —— 更新:看发布位有没有新版本,有就下载、校验、解压到旁边、把 current 指过去。
//
// 应用目录长这样(install.sh 建的):
//   ~/Applications/Fairwind/app-0.1.0/   ← 一个版本一个文件夹
//   ~/Applications/Fairwind/app-0.2.0/
//   ~/Applications/Fairwind/current → app-0.2.0   ← 启动器只认这个指针
// 更新只换指针,旧版留着(回滚 = 把指针指回去)。数据目录不在这儿,更新永远不碰它。
// 第一版「检查」自动(启动时 + 每小时)、「执行」靠人点;以后把执行也挂自动,机制不变。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, symlinkSync, unlinkSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const PLATFORM = `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`

const cmp = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0) }
  return 0
}

/**
 * 看发布位。latestUrl 指向 latest.json。返回 { current, latest, note, canUpdate, url, sha256, size, error? }。
 * 没配发布位 / 没网 / 没这个平台的包 → canUpdate:false 带原因,不抛。
 */
export async function checkUpdate({ current, latestUrl, platform = PLATFORM, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  if (!latestUrl) return { current, latest: null, canUpdate: false, error: '没配发布位' }
  try {
    const r = await fetchImpl(latestUrl, { cache: 'no-store' })
    if (!r.ok) return { current, latest: null, canUpdate: false, error: `发布位回 ${r.status}` }
    const j = await r.json()
    const p = j.platforms?.[platform]
    if (!p) return { current, latest: j.version, note: j.note || '', canUpdate: false, error: `这版没有 ${platform} 的包` }
    const url = /^[a-z]+:/.test(p.url) ? p.url : new URL(p.url.replace(/^\//, ''), latestUrl).href
    return { current, latest: j.version, note: j.note || '', canUpdate: cmp(j.version, current) > 0, url, sha256: p.sha256, size: p.size }
  } catch (e) { return { current, latest: null, canUpdate: false, error: e.message } }
}

/**
 * 下载、校验、解压、换指针。appRoot = ~/Applications/Fairwind。
 * 返回 { version, dir, previous }。失败时不动 current。
 */
export async function applyUpdate({ appRoot, version, url, sha256, fetchImpl = (...a) => globalThis.fetch(...a), log = () => {} }) {
  if (!appRoot || !existsSync(appRoot)) throw new Error(`应用目录不对:${appRoot}`)
  const dest = join(appRoot, `app-${version}`)
  if (existsSync(dest)) { log(`  · app-${version} 已经在了,直接指过去`); return repoint(appRoot, version) }
  const zip = join(appRoot, `app-${version}.zip`)
  log(`  · 下载 ${url}`)
  const r = await fetchImpl(url)
  if (!r.ok) throw new Error(`下载失败:${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (sha256) {
    const got = createHash('sha256').update(buf).digest('hex')
    if (got !== sha256) throw new Error(`包校验不对(要 ${sha256.slice(0, 12)}…,得到 ${got.slice(0, 12)}…)`)
  }
  writeFileSync(zip, buf)
  const unz = join(appRoot, `app-${version}.partial`)
  rmSync(unz, { recursive: true, force: true }); mkdirSync(unz)
  log('  · 解压')
  if (process.platform === 'darwin') execFileSync('ditto', ['-x', '-k', zip, unz])
  else execFileSync('unzip', ['-q', zip, '-d', unz])
  // zip 里是 Fairwind/ 这一层
  const inner = existsSync(join(unz, 'Fairwind')) ? join(unz, 'Fairwind') : unz
  renameSync(inner, dest)
  rmSync(unz, { recursive: true, force: true }); unlinkSync(zip)
  return repoint(appRoot, version)
}

function repoint(appRoot, version) {
  const link = join(appRoot, 'current')
  let previous = null
  try { if (lstatSync(link).isSymbolicLink()) previous = readlink(link) } catch (_) {}
  const tmp = join(appRoot, 'current.new')
  try { unlinkSync(tmp) } catch (_) {}
  symlinkSync(`app-${version}`, tmp)
  renameSync(tmp, link)                // 换指针是原子的
  return { version, dir: join(appRoot, `app-${version}`), previous }
}

function readlink(p) { return execFileSync('readlink', [p]).toString().trim() }

export function currentVersionOf(appRoot) {
  try { return readFileSync(join(appRoot, 'current', 'VERSION'), 'utf8').trim() } catch { return null }
}
