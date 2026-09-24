// brain/judgments.js —— 学员自己的判据文档(设计稿 2026-09-16 第八节)。
//
// 骨架(judge.js 的 TRANSITIONS:每格问什么、返回哪几个字段、从哪格走到哪格)在代码里,
// 学员改不了;口味(催的节奏、拿不准偏哪边、见面和等待撞上听谁的)由学员在
// <数据目录>/judgments/*.md 里写,拼到那一格提示词的**收尾之前**——字段规格必须是最后一段。
//
// 文件名用中文,一格一个;「全部.md」每一格都带上。没有的文件 = 空。
import { readFileSync, readdirSync, existsSync, watch, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const FILES = {
  '全部.md': '*',
  '对方来信.md': 'THEIR_LETTER',
  '我发出的信.md': 'MY_LETTER',
  '手记.md': 'NOTE',
  '见面之后.md': 'YOUR_ANSWER',
}
const FIELDS = ['gist', 'needs_reply', 'reply_why', 'awaiting', 'wait_days', 'meet_at', 'resolves', 'resolves_why']

let DIR = null
let DOCS = {}          // 事件名 → 文本;'*' 是全部
let ENABLED = true
let WATCHER = null
let SUPPRESS = false      // 回退那一次临时不拼判据

/** 读一遍目录。返回 { docs, lints }。 */
export function loadJudgments(dir) {
  const docs = {}, lints = []
  if (!dir || !existsSync(dir)) return { docs, lints }
  for (const f of readdirSync(dir)) {
    const ev = FILES[f]; if (!ev) continue
    const text = readFileSync(join(dir, f), 'utf8')
    if (text.trim()) docs[ev] = text.trim()
    lints.push(...lintJudgments(f, text))
  }
  return { docs, lints }
}

/** 找「改字段」的句子:字段由骨架定,这些句子写了不生效——启动和热重载时点名。 */
export function lintJudgments(file, text) {
  const out = []
  // 只点「动结构」的句子(加一个字段、删掉某个字段)。「wait_days 改成 10」是改口味,正是该写的,不点。
  const re = new RegExp(`(增加|加一个|加上|新增)[^\\n]{0,12}(字段|栏|列)|(去掉|删掉|删除)[^\\n]{0,20}(${FIELDS.join('|')})|(${FIELDS.join('|')})[^\\n]{0,12}(去掉|删掉|删除|不要了)`)
  text.split('\n').forEach((line, i) => { if (re.test(line)) out.push(`${file} 第 ${i + 1} 行:字段由系统定,这句不生效`) })
  return out
}

/** 装上目录:读一遍,之后文件一改就重读。log 收提示。 */
export function useJudgmentsDir(dir, { log = () => {} } = {}) {
  DIR = dir
  const reload = () => {
    const { docs, lints } = loadJudgments(DIR)
    DOCS = docs
    for (const l of lints) log(`  ⚠️ 判据文档:${l}`)
    const n = Object.keys(docs).length
    if (n) log(`  · 判据文档:${Object.keys(docs).map((k) => k === '*' ? '全部' : k).join('、')}`)
  }
  reload()
  if (WATCHER) { WATCHER.close(); WATCHER = null }
  if (dir && existsSync(dir)) {
    try { WATCHER = watch(dir, { persistent: false }, () => setTimeout(reload, 150)) } catch (_) {}
  }
  return DOCS
}

export function setJudgmentsEnabled(on) { ENABLED = Boolean(on) }
export function judgmentsEnabled() { return ENABLED }
export function hasJudgments() { return ENABLED && Object.keys(DOCS).length > 0 }

/** 这一格该拼进去的文字。开关关着或没写 = 空串。 */
export function judgmentsFor(ev) {
  if (!ENABLED || SUPPRESS) return ''
  const parts = [DOCS['*'], DOCS[ev]].filter(Boolean)
  return parts.length ? `\n【${ev === 'YOUR_ANSWER' ? '见面之后' : ev === 'MY_LETTER' ? '我发出的信' : ev === 'NOTE' ? '手记' : ev === 'THEIR_LETTER' ? '对方来信' : ev},我的判据】\n${parts.join('\n\n')}\n` : ''
}

/** 测试用:直接塞文档,不读盘。 */
export function _setDocs(docs) { DOCS = { ...docs } }

/** 这一段里不拼判据文档(回退用)。tagPass 是串行的,所以一个开关够用。 */
export async function withoutJudgments(fn) {
  SUPPRESS = true
  try { return await fn() } finally { SUPPRESS = false }
}

/**
 * 判一次;没按格式回话、而且判据文档在起作用 → 用出厂判据再判一次,日志点名。
 * run() 负责真的去问模型(拿到文本),parse() 负责解析;两个都从外面给,方便测。
 */
export async function judgeWithFallback(run, parse, { log = () => {}, what = '' } = {}) {
  let tag = parse(await run())
  if (tag || !hasJudgments()) return { tag, fellBack: false }
  log(`  ⚠️ ${what}:带着判据文档没判出来(${Object.keys(DOCS).map((k) => k === '*' ? '全部.md' : k).join('、')}),用出厂判据再判一次`)
  tag = await withoutJudgments(async () => parse(await run()))
  return { tag, fellBack: true }
}

/** 五个文件的内容(没有的是空串)。页面的判据编辑器和 MCP 都用它。 */
export function readJudgmentFiles(dir) {
  const out = {}
  for (const f of Object.keys(FILES)) { const p = join(dir, f); out[f] = existsSync(p) ? readFileSync(p, 'utf8') : '' }
  return out
}
/** 整个换掉一个文件。只认那五个名字。返回 lint。 */
export function writeJudgmentFile(dir, file, content) {
  if (!(file in FILES)) throw new Error(`只能写这几个文件:${Object.keys(FILES).join('、')}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), String(content ?? ''))
  return lintJudgments(file, String(content ?? ''))
}
