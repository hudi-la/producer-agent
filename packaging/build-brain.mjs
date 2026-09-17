// packaging/build-brain.mjs —— esbuild 把一个入口打成 CJS,bytenode 编成字节码。
//   node packaging/build-brain.mjs brain/local/spike.js spike
//   node packaging/build-brain.mjs brain/server.js brain
// 产物在 brain/dist/<name>.jsc(或 outDir 指定的地方)。放在 brain/ 底下,是为了运行时能找到 brain/node_modules。
// **字节码必须由将来跑它的那个 node 编**(V8 版本要一致)——所以要用自带的 node 跑这个脚本。
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdirSync, unlinkSync, copyFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** @returns {Promise<string>} 字节码文件的路径 */
export async function buildBrain(entry, name, { outDir = resolve(ROOT, 'brain/dist'), define = {}, node = process.execPath } = {}) {
  const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version
  const out = resolve(outDir, `${name}.cjs`)
  mkdirSync(outDir, { recursive: true })
  await build({
    entryPoints: [resolve(ROOT, entry)], outfile: out, bundle: true, platform: 'node', format: 'cjs', target: 'node24',
    packages: 'external',                       // node_modules 不打进去,运行时从旁边的 node_modules 找
    define: { 'import.meta.url': '__IMPORT_META_URL', __FAIRWIND_VERSION__: JSON.stringify(version), ...define },
    banner: { js: "const __IMPORT_META_URL = require('node:url').pathToFileURL(__filename).href;" },
    logLevel: 'warning',
  })
  // 编字节码的 node 必须是将来跑它的那个
  execFileSync(node, [resolve(ROOT, 'brain/node_modules/bytenode/lib/cli.js'), '--compile', out], { stdio: 'inherit' })
  unlinkSync(out)                               // 只留字节码,不留明文
  // 前言是 SQL 不是 JS,不进 bundle;放在字节码旁边,运行时按 import.meta.url 找得到
  copyFileSync(resolve(ROOT, 'brain/local/preamble.sql'), resolve(outDir, 'preamble.sql'))
  return resolve(outDir, `${name}.jsc`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [entry, name] = process.argv.slice(2)
  if (!entry || !name) { console.error('用法:node packaging/build-brain.mjs <entry> <name>'); process.exit(1) }
  const p = await buildBrain(entry, name)
  console.log(`✓ ${p}  (node ${process.version})`)
}
