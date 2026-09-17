// 一次性：把那张 Excel 搬进机会池。
//
//   npm run import:xlsx  [--file <路径>] [--dry]
//
// **只读 Excel，一个字节都不写它。** 原文件留档，导完之后库是唯一真相。
//
// 为什么单独一个脚本、不塞进 server.js：这是一次性的搬家，不是每周要跑的活。
// 塞进服务里的话它会一直挂在那儿，而且没人记得它已经跑过了。
//
// 设计稿：docs/specs/2026-09-03-opportunity-pool-design.md 第一节

import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_FILE = '/Users/dihu/Desktop/applicaitons/opportunity/HuDi_Opportunities.xlsx'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n✗ 缺配置。brain/.env 里要有 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY。\n')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const FILE = (() => {
  const i = argv.indexOf('--file')
  return i >= 0 && argv[i + 1] ? argv[i + 1] : DEFAULT_FILE
})()

// ── 单元格 → 字符串 ────────────────────────────────────────────
// exceljs 的格子可能是富文本、公式、超链接对象。全都摊平成字符串，
// 摊不平的宁可留空 —— 把 [object Object] 存进库比空着坏得多。
export const cell = (x) => {
  if (x == null) return null
  if (typeof x === 'string') return x.trim() || null
  if (typeof x === 'number') return String(x)
  if (x instanceof Date) return x.toISOString().slice(0, 10)
  if (typeof x === 'object') {
    if (Array.isArray(x.richText)) return x.richText.map((r) => r.text).join('').trim() || null
    if (x.text) return String(x.text).trim() || null
    if (x.hyperlink) return String(x.hyperlink).trim() || null
    if (x.result != null) return String(x.result).trim() || null
  }
  return null
}

// ── 状态：Excel 的图例 → 库里的三档 ────────────────────────────
//
// 原文一律留进 notes（见 rowToOpp）。图例本身信息量比三档大（⭐重点投递、
// ⚪维护关系、✅已投递），丢掉那些字等于丢掉他的判断。
export function statusOf(s) {
  const t = String(s || '')
  if (/🟢|⭐/.test(t)) return 'open'
  if (/🟡/.test(t)) return 'closed'
  if (/✅|🎉/.test(t)) return 'closed'    // 已投 / 已录取：卡才是真相，池子这行只是留个位
  return 'unknown'                        // ⚪ 维护关系、以及空的
}

export const starsOf = (s) => {
  const n = (String(s || '').match(/★/g) || []).length
  return n >= 3 ? 3 : n === 2 ? 2 : n === 1 ? 1 : null
}

// ── 日期 ──────────────────────────────────────────────────────
//
// 解析不出来就返回 null，**绝不猜**。deadline 那一列的原话一个字不动地留着
// （"持续关注" / "推荐制，全年" / "spring 2027" 都是真信息），
// deadline_at 只在能定到具体某一天时才填。复查那一步会去官网核实真的日子。
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
                'july', 'august', 'september', 'october', 'november', 'december']

export function dateOf(s) {
  const t = String(s || '')
  let m
  // 2026-09-03 / 2026/9/3
  m = t.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return iso(m[1], m[2], m[3])
  // 2026年9月3日
  m = t.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (m) return iso(m[1], m[2], m[3])
  // September 28, 2026 / Sept 28 2026
  m = t.match(new RegExp(`(${MONTHS.map((x) => x.slice(0, 3)).join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})`, 'i'))
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase()))
    if (mi >= 0) return iso(m[3], mi + 1, m[2])
  }
  // 28.08.2026（德语站常见）
  m = t.match(/(\d{1,2})\.(\d{1,2})\.(20\d{2})/)
  if (m) return iso(m[3], m[2], m[1])
  return null
}

function iso(y, mo, d) {
  const M = Number(mo), D = Number(d)
  if (!(M >= 1 && M <= 12) || !(D >= 1 && D <= 31)) return null
  return `${y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`
}

// ── 一行 → 一个机会 ────────────────────────────────────────────
// 表头：A类型 B名称 C机构 D地点 E资助 F下次截止 G状态 H匹配度 I中文简介 J英文Notes K链接 L发现日期 M来源
export function rowToOpp(cells, { hold = false } = {}) {
  const [kind, title, org, location, funding, deadline, status, fit, why, notes, url, added, src] = cells
  if (!title) return null
  const st = statusOf(status)
  // 原状态那行字留着：⭐重点投递 / ⚪维护关系 / ✅已投递 都是他的判断，三档装不下
  const keep = [
    status ? `【Excel 原状态】${status}` : null,
    added ? `【原表加入】${added}${src ? ` · ${src}` : ''}` : null,
    notes,
  ].filter(Boolean).join('\n')
  return {
    p_title: title,
    p_org: org,
    p_kind: kind,
    p_location: location,
    p_funding: funding,
    p_url: url,
    p_deadline: deadline,
    p_deadline_at: dateOf(deadline),
    // 「即将开放」那两行有开放日的信息，但原表没单独一列。开放日交给复查去查。
    p_opens_at: null,
    p_status: st,
    p_fit_stars: starsOf(fit),
    // 资格搁置页整页都是身份不符的
    p_eligible: !hold,
    p_why: why,
    p_notes: keep || null,
    p_source: 'excel',
    p_task_id: null,
  }
}

// ── 跑 ────────────────────────────────────────────────────────
async function main() {
  console.log(`\n读 ${FILE}（只读）`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(FILE)

  const rows = []
  for (const [sheet, hold] of [['Opportunities', false], ['待身份变化 Eligibility Hold', true]]) {
    const ws = wb.getWorksheet(sheet)
    if (!ws) { console.warn(`  ⚠️ 没有「${sheet}」这一页，跳过`); continue }
    let n = 0
    ws.eachRow((row, i) => {
      if (i < 2) return                       // 第一行是表头
      const opp = rowToOpp(row.values.slice(1).map(cell), { hold })
      if (opp) { rows.push(opp); n++ }
    })
    console.log(`  「${sheet}」${n} 行`)
  }

  // 表内自己也可能重（两页之间、或同一页里）。标题对标题，先到的赢。
  const seen = new Set()
  const uniq = rows.filter((r) => {
    const k = r.p_title.trim().toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (uniq.length !== rows.length) console.log(`  表内重复 ${rows.length - uniq.length} 行，去掉`)

  if (DRY) {
    console.log(`\n[--dry] 不写库。${uniq.length} 行，头三行长这样：`)
    console.log(JSON.stringify(uniq.slice(0, 3), null, 1))
    return
  }

  let made = 0, had = 0, failed = 0
  for (const r of uniq) {
    const { data, error } = await db.rpc('pa_upsert_opportunity', r)
    if (error) { failed++; console.warn(`  ✗ ${r.p_title}：${error.message}`); continue }
    data?.created ? made++ : had++
  }
  console.log(`\n进池子：新增 ${made} 行，已有 ${had} 行${failed ? `，失败 ${failed} 行` : ''}`)

  // 跟看板上已有的卡对上。对上的行显示「已在看板上」，不会被复查、也不会再造一张卡。
  const { data: linked, error: le } = await db.rpc('pa_link_pool_to_cards')
  if (le) console.warn('  ⚠️ 对卡失败：' + le.message)
  else console.log(`对上看板已有的卡：${linked} 行`)
}

// 直接跑才动库；被 import（测试）时只拿纯函数。
if (process.argv[1] && process.argv[1].endsWith('import-xlsx.js')) {
  main().catch((err) => { console.error('\n✗ ' + err.message + '\n'); process.exit(1) })
}
