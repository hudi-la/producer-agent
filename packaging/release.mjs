// packaging/release.mjs —— 发一版:改版本号 → 打包 → 建 GitHub Release → 传三个文件 → 校验。
//
//   packaging/runtime/node-darwin-arm64/bin/node packaging/release.mjs 0.1.2 "这版改了什么"
//
// 要用自带的 node(字节码由它编)。zip 走 curl 传(gh 传大文件常断还留半截)。
// 学员那边不用做任何事:程序每小时看一眼 latest.json,看见新版本就在顶栏亮点。
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
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

say('打包')
run(`"${process.execPath}" packaging/build.mjs`)
const zip = resolve(ROOT, `packaging/out/Fairwind-${version}-mac-arm64.zip`)
if (!existsSync(zip)) { console.error('没打出 zip'); process.exit(1) }

say('提交版本号')
run(`git add package.json brain/package.json packaging/release.json && git commit -q -m "v${version}${note ? '：' + note : ''}" && git tag -f v${version}`)

say(`Release v${version}`)
const exists = (() => { try { sh(`gh release view v${version} --repo ${REPO}`); return true } catch { return false } })()
if (!exists) run(`gh release create v${version} --repo ${REPO} --title "Fairwind ${version}" --notes ${JSON.stringify((note || '') + '\n\n装机 / Install:\n    curl -fsSL https://github.com/hudi-la/fairwind-releases/releases/latest/download/install.sh | sh')} packaging/out/latest.json packaging/install.sh`)
else run(`gh release upload v${version} --repo ${REPO} --clobber packaging/out/latest.json packaging/install.sh`)
const relId = sh(`gh api repos/${REPO}/releases/tags/v${version} --jq .id`)
const token = sh('gh auth token')
for (let i = 1; i <= 4; i++) {
  for (const id of sh(`gh api repos/${REPO}/releases/${relId}/assets --jq '.[] | select(.name | endswith(".zip")) | .id'`).split('\n').filter(Boolean)) sh(`gh api -X DELETE repos/${REPO}/releases/assets/${id}`)
  const code = sh(`curl -sS -o /dev/null -w '%{http_code}' --http1.1 -X POST -H "Authorization: token ${token}" -H "Content-Type: application/zip" --data-binary @"${zip}" "https://uploads.github.com/repos/${REPO}/releases/${relId}/assets?name=Fairwind-${version}-mac-arm64.zip"`)
  console.log(`  传 zip 第 ${i} 次:HTTP ${code}`)
  if (code === '201') break
  if (i === 4) { console.error('zip 传不上去,网络的事,再跑一次'); process.exit(1) }
}
say('校验')
const assets = sh(`gh release view v${version} --repo ${REPO} --json assets -q '.assets[] | .name + " " + (.size|tostring)'`)
console.log(assets)
console.log(`\n✓ 发好了:https://github.com/${REPO}/releases/tag/v${version}\n  学员那边一小时内自己看见;想立刻看:打开 Fairwind → 关于你 → 检查更新。\n  别忘了 git push origin workshop-edition --tags`)
