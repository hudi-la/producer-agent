// 扫界面代码里「没过 t() 的中文」——英文版里会原样露出中文的地方(2026-10-08 他说:没做好就是 bug)。
//
//   node scripts/untranslated.mjs            按文件列出来
//   node scripts/untranslated.mjs --json     机器读
//
// 规则:src 下的 .jsx/.js(除了 i18n/、demo*、测试),语法树里所有带中文的字符串 / 模板 / JSX 文字,
// 只要不是 t('…') 的第一个参数就算。注释不算。console.* 里的不算(给开发看的)。
// 真不该翻的(比如拿来匹配后台中文报错的正则)用 // i18n-ok 标在那一行。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from '@babel/parser'

const ROOT = new URL('../src/', import.meta.url).pathname
const CJK = /[㐀-鿿　-〿＀-￯]/
const files = []
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!/^(i18n|demo|demo-empty)$/.test(f)) walk(p) } else if (/\.(jsx|js)$/.test(f) && !/\.test\./.test(f)) files.push(p) } }
walk(ROOT)
// Greetable.jsx 是死组件(8/13 起没人引用);judgmentDefaults.js 自己就分中英两份
const SKIP = /components\/Greetable\.jsx$|lib\/judgmentDefaults\.js$/
files.splice(0, files.length, ...files.filter((f) => !SKIP.test(f)))

export function scanFile(file) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true })
  const hits = []
  const visit = (node, parent, parent2) => {
    if (!node || typeof node.type !== 'string') return
    const isT = (call) => call?.type === 'CallExpression' && call.callee?.type === 'Identifier' && call.callee.name === 't'
    const isConsole = (call) => call?.type === 'CallExpression' && call.callee?.type === 'MemberExpression' && call.callee.object?.name === 'console'
    let text = null
    if (node.type === 'StringLiteral') text = node.value
    else if (node.type === 'JSXText') text = node.value.trim()
    else if (node.type === 'TemplateLiteral') text = node.quasis.map((q) => q.value.cooked).join('${}')
    if (text && CJK.test(text)) {
      const inT = isT(parent) && parent.arguments[0] === node
      const line = node.loc.start.line
      const ok = /i18n-ok/.test(lines[line - 1] || '') || isConsole(parent) || isConsole(parent2) || parent?.type === 'ImportDeclaration'
        || (parent?.type === 'ObjectProperty' && parent.key === node)              // 对象的键(比如字典、数据列名)
        || (parent?.type === 'MemberExpression' && parent.property === node)      // r['封数'] 读数据列
      if (!inT && !ok) hits.push({ line, text: text.replace(/\s+/g, ' ').slice(0, 80) })
      if (node.type === 'TemplateLiteral') return
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue
      const v = node[k]
      if (Array.isArray(v)) for (const c of v) visit(c, node, parent)
      else if (v && typeof v.type === 'string') visit(v, node, parent)
    }
  }
  visit(ast.program, null, null)
  return hits
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = files.map((f) => ({ file: relative(ROOT, f), hits: scanFile(f) })).filter((x) => x.hits.length).sort((a, b) => b.hits.length - a.hits.length)
  if (process.argv.includes('--json')) console.log(JSON.stringify(all))
  else { for (const x of all) console.log(String(x.hits.length).padStart(4), x.file); console.log('合计', all.reduce((n, x) => n + x.hits.length, 0), '处,', all.length, '个文件') }
}
