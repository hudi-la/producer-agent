// brain/version.js —— 版本号只有一个来源:根 package.json 的 version。
// 打包时 build.mjs 把它写进字节码旁边的 VERSION 文件(也 define 成常量兜底);开发时现读 package.json。
// 运行时先认 VERSION 文件:更新换的是整个应用文件夹,文件夹里的 VERSION 就是它的版本。
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fromFile() {
  try { const p = fileURLToPath(new URL('./VERSION', import.meta.url)); return existsSync(p) ? readFileSync(p, 'utf8').trim() : null } catch { return null }
}
function fromPackage() {
  try { return JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version } catch { return null }
}
// eslint-disable-next-line no-undef
export const VERSION = fromFile() || (typeof __FAIRWIND_VERSION__ !== 'undefined' ? __FAIRWIND_VERSION__ : null) || fromPackage() || '0.0.0'
