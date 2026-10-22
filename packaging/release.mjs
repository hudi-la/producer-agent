// packaging/release.mjs —— 发一版。两条路:
//
//   A. 包直接传 GitHub(本机网络传得上 300MB 时):
//      packaging/runtime/node-darwin-arm64/bin/node packaging/release.mjs 0.1.2 "这版改了什么"
//
//   B. 包走 Google Drive(本机传不上 GitHub 时,10/1 起一直这样):
//      ① node packaging/release.mjs 0.1.2 "这版改了什么" --stage
//         → 改版本号、打包、建成预发布;两个 zip 复制到 ~/Downloads/Fairwind-0.1.2/ 并打开那个文件夹。
//         把两个 zip 拖进 Drive 网页,都设成「知道链接的任何人都可以查看」。
//      ② node packaging/release.mjs 0.1.2 --drive <链接1> <链接2>
//         → 两个链接各下载一遍、按指纹认出哪个是哪个平台(贴反了也不怕,贴错版本会被拦),
//           写进 latest.json、传 latest.json + install.sh 到 GitHub、转成「最新」、按学员的方式装一遍验收。
//
// 要用自带的 node(字节码由它编)。学员那边不用做任何事:程序每小时看一眼 latest.json,看见新版本就在顶栏亮点。
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, copyFileSync, rmSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const flagAt = (f) => args.indexOf(f)
const STAGE = flagAt('--stage') >= 0
const DRIVE = flagAt('--drive') >= 0 ? args.slice(flagAt('--drive') + 1) : null
const [version, note] = args.filter((a, i) => !a.startsWith('--') && (DRIVE === null || i < flagAt('--drive')))
if (!/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('用法:node packaging/release.mjs <版本号 如 0.1.2> "这版改了什么" [--stage]\n      node packaging/release.mjs <版本号> --drive <链接1> <链接2>'); process.exit(1) }
const REPO = 'hudi-la/fairwind-releases'
const sh = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString().trim()
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
const say = (s) => console.log(`\n── ${s}`)
const PLATS = ['mac-arm64', 'mac-x64']
const zipOf = (p) => resolve(ROOT, `packaging/out/Fairwind-${version}-${p}.zip`)
const LATEST = resolve(ROOT, 'packaging/out/latest.json')
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

if (DRIVE) await finishWithDrive(DRIVE)
else await stageOrPublish()

async function stageOrPublish() {
  say(`版本号 → ${version}`)
  for (const f of ['package.json', 'brain/package.json']) { const p = JSON.parse(readFileSync(resolve(ROOT, f), 'utf8')); p.version = version; writeFileSync(resolve(ROOT, f), JSON.stringify(p, null, 2) + '\n') }
  const rel = JSON.parse(readFileSync(resolve(ROOT, 'packaging/release.json'), 'utf8')); if (note) rel.note = note
  writeFileSync(resolve(ROOT, 'packaging/release.json'), JSON.stringify(rel, null, 2) + '\n')

  say('打包(mac-arm64)')
  run(`"${process.execPath}" packaging/build.mjs`)
  // Intel 版:packaging/runtime/node-darwin-x64 在的话,借 Rosetta 用它再出一份(字节码和 SDK 二进制都按 x64 来)
  const X64 = resolve(ROOT, 'packaging/runtime/node-darwin-x64/bin/node')
  if (existsSync(X64)) { say('打包(mac-x64,Rosetta)'); run(`arch -x86_64 "${X64}" packaging/build.mjs`) }
  else console.warn('  没有 packaging/runtime/node-darwin-x64,这版不出 Intel 包(照 SPIKE.md 下载一份就有)')
  const zips = ['mac-arm64', ...(existsSync(X64) ? ['mac-x64'] : [])].map(zipOf)
  for (const z of zips) if (!existsSync(z)) { console.error('没打出 ' + z); process.exit(1) }

  say('提交版本号')
  run(`git add package.json brain/package.json packaging/release.json && (git commit -q -m "v${version}${note ? '：' + note : ''}" || true) && git tag -f v${version}`)   // 重跑时没改动也别炸

  const relId = ensurePrerelease()

  if (STAGE) {
    // 包不走 GitHub:复制到下载目录,打开给他拖进 Drive。Desktop 在 iCloud 里,.claude 又是隐藏目录,Finder 里常看不见
    const dir = join(homedir(), 'Downloads', `Fairwind-${version}`)
    mkdirSync(dir, { recursive: true })
    for (const z of zips) copyFileSync(z, join(dir, z.split('/').pop()))
    try { execFileSync('open', [dir]) } catch {}
    say('停在这儿')
    console.log(`  两个 zip 在 ${dir}(已在 Finder 里打开)。拖进 Google Drive,都设成「知道链接的任何人都可以查看」,然后:\n\n    node packaging/release.mjs ${version} --drive <链接1> <链接2>\n\n  v${version} 现在是预发布,「最新」仍指向上一版,学员那边不受影响。`)
    return
  }

  const token = sh('gh auth token')
  // 每个 zip:先 gh(Go 的 http),不行换 node 的 fetch;本机对大文件的 TLS 时好时坏,两条路轮着来
  for (const zip of zips) {
    const zipName = zip.split('/').pop(); const want = String(statSync(zip).size)
    if (sizeOf(relId, zipName) === want) { console.log(`  ${zipName} 已经在`); continue }
    let up = false
    for (let i = 1; i <= 8 && !up; i++) {
      dropAsset(relId, zipName)
      if (i % 2 === 1) { try { run(`gh release upload v${version} --repo ${REPO} --clobber "${zip}"`) } catch {} }
      else { try { const r = await fetch(`https://uploads.github.com/repos/${REPO}/releases/${relId}/assets?name=${encodeURIComponent(zipName)}`, { method: 'POST', headers: { authorization: `token ${token}`, 'content-type': 'application/zip', 'content-length': want }, body: readFileSync(zip), duplex: 'half' }); await r.text() } catch (e) { console.log('  ' + (e.cause?.code || e.message)) } }
      up = sizeOf(relId, zipName) === want
      console.log(`  ${zipName} 第 ${i} 次:${up ? '成' : '没成'}`)
      if (!up) await new Promise((r) => setTimeout(r, 15000))
    }
    if (!up) { console.error(`${zipName} 传不上去,网络的事。版本留在预发布,再跑一次这条命令接着传;或者走 Drive:--stage 然后 --drive`); process.exit(1) }
  }
  publishLatest()
}

/** 两个 Drive 链接 → 下载、按指纹认平台、写 latest.json、发出去 */
async function finishWithDrive(links) {
  if (links.length !== PLATS.length) { console.error(`--drive 后面要 ${PLATS.length} 个链接(Apple 芯片包、Intel 包,顺序随意)`); process.exit(1) }
  const local = {}
  for (const p of PLATS) { if (!existsSync(zipOf(p))) { console.error(`本机没有 ${zipOf(p)},先跑 --stage`); process.exit(1) }; local[sha256(readFileSync(zipOf(p)))] = p }
  const found = {}
  say('下载核对')
  for (const link of links) {
    const id = link.match(/\/d\/([\w-]+)/)?.[1] || link.match(/[?&]id=([\w-]+)/)?.[1]
    if (!id) { console.error(`看不出这是 Drive 链接:${link}`); process.exit(1) }
    const url = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`   // confirm=t 跳过大文件的「确认下载」页;curl 和 node fetch 都直接拿到 zip
    const r = await fetch(url); if (!r.ok) { console.error(`下不下来(HTTP ${r.status}):${link}。分享权限是不是没设成「知道链接的任何人」?`); process.exit(1) }
    const buf = Buffer.from(await r.arrayBuffer()); const h = sha256(buf)
    const p = local[h]
    if (!p) { console.error(`这个链接的文件不是这版的包(${(buf.length / 1e6).toFixed(0)} MB,指纹 ${h.slice(0, 12)}…):${link}\n  贴错了?看看是不是旧版本或别的文件`); process.exit(1) }
    if (found[p]) { console.error(`两个链接都是 ${p} 的包,少了另一个平台`); process.exit(1) }
    found[p] = { url, sha256: h, size: buf.length }
    console.log(`  ${p} ✓ ${link}`)
  }
  const j = JSON.parse(readFileSync(LATEST, 'utf8'))
  if (j.version !== version) { console.error(`packaging/out/latest.json 是 ${j.version} 的,不是 ${version};先跑 --stage`); process.exit(1) }
  for (const p of PLATS) j.platforms[p] = { ...j.platforms[p], ...found[p] }
  writeFileSync(LATEST, JSON.stringify(j, null, 2) + '\n')
  ensurePrerelease()
  publishLatest()
}

function ensurePrerelease() {
  say(`Release v${version}`)
  // 先建成**预发布**:「最新」在包全就位之前仍指向上一版,学员那边不会撞到没有包的版本(9/24 撞过一次)
  const exists = (() => { try { sh(`gh release view v${version} --repo ${REPO}`); return true } catch { return false } })()
  if (!exists) run(`gh release create v${version} --repo ${REPO} --prerelease --title "Fairwind ${version}" --notes ${JSON.stringify((note || JSON.parse(readFileSync(resolve(ROOT, 'packaging/release.json'), 'utf8')).note || '') + '\n\n装机 / Install:\n    curl -fsSL https://github.com/hudi-la/fairwind-releases/releases/latest/download/install.sh | sh')} packaging/install.sh`)
  return sh(`gh api repos/${REPO}/releases/tags/v${version} --jq .id`)
}
// 只认 state=uploaded 的:传到一半断了 GitHub 会留一条 state=starter 的僵尸记录,
// 它带着请求头里声明的 size(文件体根本没到),光比尺寸会被它骗过去——9/24 就是这么发出一个没有包的版本的
function sizeOf(relId, name) { return sh(`gh api repos/${REPO}/releases/${relId}/assets --jq '.[] | select(.name == "${name}" and .state == "uploaded") | .size'`) }
function dropAsset(relId, name) { for (const id of sh(`gh api repos/${REPO}/releases/${relId}/assets --jq '.[] | select(.name == "${name}") | .id'`).split('\n').filter(Boolean)) sh(`gh api -X DELETE repos/${REPO}/releases/assets/${id}`) }

function publishLatest() {
  run(`gh release upload v${version} --repo ${REPO} --clobber packaging/out/latest.json packaging/install.sh`)
  run(`gh release edit v${version} --repo ${REPO} --prerelease=false --latest`)   // 发布库里所有 release 指向同一个 commit,GitHub 分不出先后,得明说这个是最新
  say('验收:按学员的方式从公开地址装一遍')
  const home = mkdtempSync(join(tmpdir(), 'fairwind-accept-'))
  let ok = false
  for (let i = 0; i < 6 && !ok; i++) {   // latest/download/ 有 CDN 缓存,刚传完可能还是旧的
    try { ok = sh(`curl -fsSL "https://github.com/${REPO}/releases/latest/download/latest.json?x=${Date.now()}"`).includes(`"version": "${version}"`) } catch {}
    if (!ok) execSync('sleep 15')
  }
  if (!ok) { console.error('公开地址上的 latest.json 还不是这版,过一分钟再看一眼'); process.exit(1) }
  try {
    execSync(`curl -fsSL https://github.com/${REPO}/releases/latest/download/install.sh | sh`, { stdio: 'inherit', env: { ...process.env, HOME: home, FAIRWIND_NO_OPEN: '1' } })
    const got = readFileSync(join(home, 'Applications/Fairwind/current/VERSION'), 'utf8').trim()
    if (got !== version) throw new Error(`装出来是 ${got}`)
  } catch (e) { console.error(`✗ 验收没过:${e.message}`); process.exit(1) }
  finally { rmSync(home, { recursive: true, force: true }) }
  console.log(`\n✓ 发好了:https://github.com/${REPO}/releases/tag/v${version}\n  学员那边一小时内自己看见;想立刻看:打开 Fairwind → 设置 → 检查更新。\n  别忘了 git push origin workshop-edition --tags`)
}
