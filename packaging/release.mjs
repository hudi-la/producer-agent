// packaging/release.mjs —— 发一版:改版本号 → 打包 → 建 GitHub Release → 传三个文件 → 校验。
//
//   packaging/runtime/node-darwin-arm64/bin/node packaging/release.mjs 0.1.2 "这版改了什么"
//
// 要用自带的 node(字节码由它编)。zip 走 curl 传(gh 传大文件常断还留半截)。
// 学员那边不用做任何事:程序每小时看一眼 latest.json,看见新版本就在顶栏亮点。
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const [version, note] = process.argv.slice(2)
if (!/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('用法:node packaging/release.mjs <版本号 如 0.1.2> "这版改了什么"'); process.exit(1) }
const REPO = 'hudi-la/fairwind-releases'
const sh = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString().trim()
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
const say = (s) => console.log(`\n── ${s}`)

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
const zips = ['mac-arm64', ...(existsSync(X64) ? ['mac-x64'] : [])].map((p) => resolve(ROOT, `packaging/out/Fairwind-${version}-${p}.zip`))
for (const z of zips) if (!existsSync(z)) { console.error('没打出 ' + z); process.exit(1) }

say('提交版本号')
run(`git add package.json brain/package.json packaging/release.json && (git commit -q -m "v${version}${note ? '：' + note : ''}" || true) && git tag -f v${version}`)   // 重跑时没改动也别炸

say(`Release v${version}`)
// 先建成**预发布**:「最新」在 zip 全传上之前仍指向上一版,学员那边不会撞到没有包的版本(9/24 撞过一次)
const exists = (() => { try { sh(`gh release view v${version} --repo ${REPO}`); return true } catch { return false } })()
if (!exists) run(`gh release create v${version} --repo ${REPO} --prerelease --title "Fairwind ${version}" --notes ${JSON.stringify((note || '') + '\n\n装机 / Install:\n    curl -fsSL https://github.com/hudi-la/fairwind-releases/releases/latest/download/install.sh | sh')} packaging/install.sh`)
else run(`gh release edit v${version} --repo ${REPO} --prerelease`)
const relId = sh(`gh api repos/${REPO}/releases/tags/v${version} --jq .id`)
const token = sh('gh auth token')
const sizeOf = (name) => sh(`gh api repos/${REPO}/releases/${relId}/assets --jq '.[] | select(.name == "${name}") | .size'`)
const dropAsset = (name) => { for (const id of sh(`gh api repos/${REPO}/releases/${relId}/assets --jq '.[] | select(.name == "${name}") | .id'`).split('\n').filter(Boolean)) sh(`gh api -X DELETE repos/${REPO}/releases/assets/${id}`) }
// 每个 zip:先 gh(Go 的 http),不行换 node 的 fetch;本机对大文件的 TLS 时好时坏,两条路轮着来
for (const zip of zips) {
  const zipName = zip.split('/').pop(); const want = String(statSync(zip).size)
  if (sizeOf(zipName) === want) { console.log(`  ${zipName} 已经在`); continue }
  let up = false
  for (let i = 1; i <= 8 && !up; i++) {
    dropAsset(zipName)
    if (i % 2 === 1) { try { run(`gh release upload v${version} --repo ${REPO} --clobber "${zip}"`) } catch {} }
    else { try { const r = await fetch(`https://uploads.github.com/repos/${REPO}/releases/${relId}/assets?name=${encodeURIComponent(zipName)}`, { method: 'POST', headers: { authorization: `token ${token}`, 'content-type': 'application/zip', 'content-length': want }, body: readFileSync(zip), duplex: 'half' }); await r.text() } catch (e) { console.log('  ' + (e.cause?.code || e.message)) } }
    up = sizeOf(zipName) === want
    console.log(`  ${zipName} 第 ${i} 次:${up ? '成' : '没成'}`)
    if (!up) await new Promise((r) => setTimeout(r, 15000))
  }
  if (!up) { console.error(`${zipName} 传不上去,网络的事。版本留在预发布,再跑一次这条命令接着传`); process.exit(1) }
}
run(`gh release upload v${version} --repo ${REPO} --clobber packaging/out/latest.json packaging/install.sh`)
run(`gh release edit v${version} --repo ${REPO} --prerelease=false`)
say('校验')
const assets = sh(`gh release view v${version} --repo ${REPO} --json assets -q '.assets[] | .name + " " + (.size|tostring)'`)
console.log(assets)
console.log(`\n✓ 发好了:https://github.com/${REPO}/releases/tag/v${version}\n  学员那边一小时内自己看见;想立刻看:打开 Fairwind → 关于你 → 检查更新。\n  别忘了 git push origin workshop-edition --tags`)
