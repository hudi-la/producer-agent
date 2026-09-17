// brain/version.js —— 版本号只有一个来源:根 package.json 的 version。
// 打包时 esbuild 把它 define 成常量(__FAIRWIND_VERSION__);开发时现读文件。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fromPackage() {
  try { return JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version } catch { return '0.0.0' }
}
// eslint-disable-next-line no-undef
export const VERSION = typeof __FAIRWIND_VERSION__ !== 'undefined' ? __FAIRWIND_VERSION__ : fromPackage()
