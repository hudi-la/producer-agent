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
// 只清这一平台的产物和别的版本的 zip:同版本另一平台的 zip 和 latest.json 留着(一台机器先出 arm64 再借 Rosetta 出 x64)
rmSync(APP, { recursive: true, force: true }); rmSync(join(OUT, 'stage'), { recursive: true, force: true }); mkdirSync(APP, { recursive: true })
for (const f of (existsSync(OUT) ? readdirSync(OUT) : [])) if (f.endsWith('.zip') && !f.startsWith(`Fairwind-${version}-`)) rmSync(join(OUT, f), { force: true })

say('前端(VITE_DB_MODE=local)')
sh('npx', ['vite', 'build'], { cwd: ROOT, env: { ...process.env, VITE_DB_MODE: 'local' } })
cpSync(resolve(ROOT, 'dist'), join(APP, 'dist'), { recursive: true })

say('brain → 字节码')
await buildBrain('brain/server.js', 'brain', { outDir: APP, define: { __FAIRWIND_RELEASE_URL__: JSON.stringify(release.latestUrl || '') } })
copyFileSync(resolve(ROOT, 'packaging/data/judgments-README.md'), join(APP, 'judgments-README.md'))
copyFileSync(resolve(ROOT, 'packaging/data/judgments-README.en.md'), join(APP, 'judgments-README.en.md'))
copyFileSync(resolve(ROOT, 'packaging/data/MCP-guide.md'), join(APP, 'MCP-guide.md'))
copyFileSync(resolve(ROOT, 'packaging/data/SETUP.md'), join(APP, 'SETUP.md'))
copyFileSync(resolve(ROOT, 'packaging/data/mcp-bridge.cjs'), join(APP, 'mcp-bridge.cjs'))   // Claude 桌面版用的 stdio 桥

say('迁移(只带新装要跑的那批)')
mkdirSync(join(APP, 'migrations'))
for (const f of migrationOrder(resolve(ROOT, 'supabase/migrations'), { fresh: true })) copyFileSync(resolve(ROOT, 'supabase/migrations', f), join(APP, 'migrations', f))

say('依赖(只装运行时的)')
const stage = join(OUT, 'stage'); mkdirSync(stage, { recursive: true })
copyFileSync(resolve(ROOT, 'brain/package.json'), join(stage, 'package.json'))
copyFileSync(resolve(ROOT, 'brain/package-lock.json'), join(stage, 'package-lock.json'))
// npm 用自带的那个 node 跑,不用系统 npm:@anthropic-ai/claude-agent-sdk 的平台二进制按跑 npm 的进程的 os/cpu 选——
// 在 Apple 芯片上借 Rosetta 出 Intel 包时,系统 npm 会装成 arm64 那份,学员机器上起不来
const npmCli = join(RUNTIME, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
sh(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--silent'], { cwd: stage })
cpSync(join(stage, 'node_modules'), join(APP, 'node_modules'), { recursive: true })
// SDK 的平台二进制走 postinstall 下载?——npm ci --ignore-scripts 会跳过;它其实是可选依赖里的文件,ci 会装。核一下:
const sdkBin = readdirSync(join(APP, 'node_modules/@anthropic-ai')).filter((d) => d.startsWith('claude-agent-sdk-'))
if (!sdkBin.length) console.warn('⚠️ 没找到 SDK 的平台二进制包(@anthropic-ai/claude-agent-sdk-<平台>),学员机器上 brain 起不来模型')
else if (!sdkBin.some((d) => d.includes(process.arch))) { console.error(`✗ SDK 平台二进制是 ${sdkBin.join(',')},跟目标 ${PLATFORM} 不符`); process.exit(1) }
else console.log('  SDK 平台二进制:' + sdkBin.join(','))
rmSync(stage, { recursive: true, force: true })

say('自带 node + 启动器')
copyFileSync(NODE_BIN, join(APP, process.platform === 'win32' ? 'node.exe' : 'node'))
copyFileSync(resolve(ROOT, 'packaging/data/launcher.cjs'), join(APP, 'launcher.cjs'))   // 启动器是一个普通文件,不在这儿拼字符串
writeFileSync(join(APP, 'VERSION'), version + '\n')
copyFileSync(resolve(ROOT, 'packaging/data/LICENSE.txt'), join(APP, 'LICENSE.txt'))
copyFileSync(resolve(ROOT, 'packaging/data/Fairwind.icns'), join(APP, 'Fairwind.icns'))   // 装机脚本放进 .app

say('打 zip')
const zipName = `Fairwind-${version}-${PLATFORM}.zip`
if (process.platform === 'darwin') sh('ditto', ['-c', '-k', '--keepParent', APP, join(OUT, zipName)])
else sh('zip', ['-qr', join(OUT, zipName), 'Fairwind'], { cwd: OUT })
const sha256 = createHash('sha256').update(readFileSync(join(OUT, zipName))).digest('hex')
const size = statSync(join(OUT, zipName)).size
let prev = {}
try { const j = JSON.parse(readFileSync(join(OUT, 'latest.json'), 'utf8')); if (j.version === version) prev = j.platforms || {} } catch {}
writeFileSync(join(OUT, 'latest.json'), JSON.stringify({
  version, note: release.note || '', publishedAt: new Date().toISOString().slice(0, 10),
  platforms: { ...prev, [PLATFORM]: { url: `${(release.downloadBase || '').replace(/\/$/, '')}/${zipName}`, sha256, size } },
}, null, 2))
console.log(`\n✓ ${join(OUT, zipName)}  ${(size / 1e6).toFixed(0)} MB\n✓ ${join(OUT, 'latest.json')}\n`)
