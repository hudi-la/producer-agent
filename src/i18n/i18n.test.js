// 代码里所有 t('…') 的键都得在 en.js 里——不然英文用户会看到一句中文冒出来。
// 扫的是源码,不是运行时:漏一个就红,合并主线之后跑一遍就知道新长的字翻了没有。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import en from './en.js'
import { t, setLang } from './index.js'

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p })
const files = walk('src').filter((f) => /\.(jsx?|js)$/.test(f) && !f.endsWith('.test.js') && !f.includes('/i18n/') && !f.includes('/demo/'))

test('t() 的每个字面量键都有英文', () => {
  const missing = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
      const key = m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'")
      if (!(key in en)) missing.push(`${f}: ${key}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('查不到就原样;插值;切回中文', () => {
  setLang('en'); assert.equal(t('这句没翻'), '这句没翻'); assert.equal(t('更新到 {v}', { v: '1.2' }), 'Update to 1.2')
  setLang('zh'); assert.equal(t('我的档案'), '我的档案')
})

// 界面代码里不许有「没过 t() 的中文」——英文版里它会原样露出来(2026-10-08 他说:没做好就是 bug)。
// 真该留中文的那一行标 // i18n-ok 并写清为什么。扫描规则见 scripts/untranslated.mjs
test('界面代码里没有漏翻的中文', async () => {
  const { execFileSync } = await import('node:child_process')
  const out = JSON.parse(execFileSync('node', ['scripts/untranslated.mjs', '--json'], { encoding: 'utf8' }))
  const list = out.flatMap((f) => f.hits.map((h) => `${f.file}:${h.line} ${h.text}`))
  assert.deepEqual(list, [], `这些中文没过 t():\n${list.join('\n')}`)
})
