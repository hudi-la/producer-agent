// packaging/build.mjs —— 打一个「文件夹应用」:自带 node + 字节码的 brain + 前端产物 + 依赖 + 迁移。
//
//   <自带的 node> packaging/build.mjs            → packaging/out/Fairwind/ + Fairwind-<ver>-<平台>.zip + latest.json
//
// **要用 packaging/runtime/ 里那份 node 跑**——字节码由它编,将来也由它跑(V8 版本必须一致)。
// 产物里没有源码、没有 demo、没有 .env、没有测试。学员机器上可写的东西全在数据目录,这个文件夹只读。
import { buildBrain } from './build-brain.mjs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrationOrder } from '../scripts/migration-order.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PLATFORM = `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`
const RUNTIME = resolve(ROOT, 'packaging/runtime', `node-${process.platform}-${process.arch}`)
const NODE_BIN = process.platform === 'win32' ? join(RUNTIME, 'node.exe') : join(RUNTIME, 'bin', 'node')
const OUT = resolve(ROOT, 'packaging/out')
const APP = join(OUT, 'Fairwind')
const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version
const release = JSON.parse(readFileSync(resolve(ROOT, 'packaging/release.json'), 'utf8'))
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })
const say = (s) => console.log(`\n── ${s}`)

if (!existsSync(NODE_BIN)) { console.error(`没有自带的 node:${NODE_BIN}\n先照 packaging/SPIKE.md 下载到 packaging/runtime/`); process.exit(1) }
if (resolve(process.execPath) !== resolve(NODE_BIN)) {
  console.error(`要用自带的 node 跑这个脚本(字节码的 V8 要跟它一致):\n  ${NODE_BIN} packaging/build.mjs`); process.exit(1)
}

say(`Fairwind ${version} · ${PLATFORM} · node ${process.version}`)
rmSync(OUT, { recursive: true, force: true }); mkdirSync(APP, { recursive: true })

say('前端(VITE_DB_MODE=local)')
sh('npx', ['vite', 'build'], { cwd: ROOT, env: { ...process.env, VITE_DB_MODE: 'local' } })
cpSync(resolve(ROOT, 'dist'), join(APP, 'dist'), { recursive: true })

say('brain → 字节码')
await buildBrain('brain/server.js', 'brain', { outDir: APP, define: { __FAIRWIND_RELEASE_URL__: JSON.stringify(release.latestUrl || '') } })
copyFileSync(resolve(ROOT, 'packaging/data/judgments-README.md'), join(APP, 'judgments-README.md'))
copyFileSync(resolve(ROOT, 'packaging/data/judgments-README.en.md'), join(APP, 'judgments-README.en.md'))

say('迁移(只带新装要跑的那批)')
mkdirSync(join(APP, 'migrations'))
for (const f of migrationOrder(resolve(ROOT, 'supabase/migrations'), { fresh: true })) copyFileSync(resolve(ROOT, 'supabase/migrations', f), join(APP, 'migrations', f))

say('依赖(只装运行时的)')
const stage = join(OUT, 'stage'); mkdirSync(stage, { recursive: true })
copyFileSync(resolve(ROOT, 'brain/package.json'), join(stage, 'package.json'))
copyFileSync(resolve(ROOT, 'brain/package-lock.json'), join(stage, 'package-lock.json'))
sh('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--silent'], { cwd: stage })
cpSync(join(stage, 'node_modules'), join(APP, 'node_modules'), { recursive: true })
// SDK 的平台二进制走 postinstall 下载?——npm ci --ignore-scripts 会跳过;它其实是可选依赖里的文件,ci 会装。核一下:
const sdkBin = readdirSync(join(APP, 'node_modules/@anthropic-ai')).filter((d) => d.startsWith('claude-agent-sdk-'))
if (!sdkBin.length) console.warn('⚠️ 没找到 SDK 的平台二进制包(@anthropic-ai/claude-agent-sdk-<平台>),学员机器上 brain 起不来模型')
rmSync(stage, { recursive: true, force: true })

say('自带 node + 启动器')
copyFileSync(NODE_BIN, join(APP, process.platform === 'win32' ? 'node.exe' : 'node'))
writeFileSync(join(APP, 'launcher.cjs'), `// Fairwind 启动器。数据在用户目录,程序在这个文件夹;这个文件夹更新时整个换。
const path = require('node:path'), os = require('node:os'), fs = require('node:fs')
const APP = __dirname
const DATA = process.env.FAIRWIND_DATA_DIR || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Fairwind')
  : process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), 'Fairwind') : path.join(os.homedir(), '.fairwind'))
fs.mkdirSync(DATA, { recursive: true })
process.env.FAIRWIND_DATA_DIR = DATA
process.env.FAIRWIND_DIST_DIR = path.join(APP, 'dist')
process.env.FAIRWIND_APP_ROOT = process.env.FAIRWIND_APP_ROOT || path.dirname(APP)
process.env.BRAIN_PORT = process.env.BRAIN_PORT || '8788'
// 云端的钥匙一律清空:这个包只走本机库
for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k]
require('bytenode')
require(path.join(APP, 'brain.jsc'))
// 起来之后把页面开出来。FAIRWIND_NO_OPEN=1 时不开(验收脚本用)
if (!process.env.FAIRWIND_NO_OPEN) setTimeout(() => {
  const url = 'http://localhost:' + process.env.BRAIN_PORT
  const { spawn } = require('node:child_process')
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try { spawn(opener, args, { stdio: 'ignore', detached: true }).unref() } catch (_) {}
}, 2500)
`)
writeFileSync(join(APP, 'VERSION'), version + '\n')
copyFileSync(resolve(ROOT, 'packaging/data/LICENSE.txt'), join(APP, 'LICENSE.txt'))

say('打 zip')
const zipName = `Fairwind-${version}-${PLATFORM}.zip`
if (process.platform === 'darwin') sh('ditto', ['-c', '-k', '--keepParent', APP, join(OUT, zipName)])
else sh('zip', ['-qr', join(OUT, zipName), 'Fairwind'], { cwd: OUT })
const sha256 = createHash('sha256').update(readFileSync(join(OUT, zipName))).digest('hex')
const size = statSync(join(OUT, zipName)).size
writeFileSync(join(OUT, 'latest.json'), JSON.stringify({
  version, note: release.note || '', publishedAt: new Date().toISOString().slice(0, 10),
  platforms: { [PLATFORM]: { url: `${(release.downloadBase || '').replace(/\/$/, '')}/${zipName}`, sha256, size } },
}, null, 2))
console.log(`\n✓ ${join(OUT, zipName)}  ${(size / 1e6).toFixed(0)} MB\n✓ ${join(OUT, 'latest.json')}\n`)
