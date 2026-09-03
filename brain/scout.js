// 定时造卡任务：拼提示词、解析信封、去重、写战报。
//
// 这儿只有纯函数（跟 timer.js / judge.js 一个分工）；调模型、认领任务、
// 建卡在 server.js 的 scoutPass。
//
// 分工的边界就是骨架 / 血肉的边界：
//   · 任务的 prompt（画像、来源、筛选规则）是血肉，存在 producer.tasks.prompt，你在面板里改
//   · 这个文件补的尾巴（今天几号、库里已有哪些、按什么格式报）是骨架，你改不到也不用改
//
// 设计稿：docs/specs/2026-09-02-scheduled-scout-design.md 第五节

export const CARDS_MARK = '[[CARDS]]'

const norm = (s) => String(s || '').trim().toLowerCase()
const normUrl = (s) => norm(s).replace(/\/+$/, '')
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * 脑子补在 prompt 后面的那段。
 * existing = [{title, org, url}]：库里已有的，让它别再报；落库前还会再对一遍。
 */
export function tail({ today, tz, existing = [], cap = 5 }) {
  const have = existing.length
    ? existing.map((e) => `- ${e.title}${e.org ? ` · ${e.org}` : ''}`).join('\n')
    : '（库里还没有机会线）'
  return `== 今天是 ${today}（${tz}）==
截止日期按今天算。**已经过了截止的不要报。**

== 库里已经有这些（标题 · 机构），已有的不要再报 ==
${have}

== 报法 ==
先用简洁中文说这轮扫了哪些源、看到了什么，三五句就够。
然后**最后一行**单独输出下面这一行，别的什么都不要加在它后面：
${CARDS_MARK} {"cards":[{"title":"机会名称","kind":"驻地|grant|奖|群展|开放征集|…","org":"机构","location":"地点","funding":"资助内容","deadline":"截止的官方原话或null","deadline_at":"YYYY-MM-DD或null","opens_at":"YYYY-MM-DD或null（当前未开放时填预计开放日）","url":"官方链接","match_stars":3或2,"why":"中文一句话理由","notes":"英文 notes；当前未开放的以「🟡 关注 · 下轮预计…」开头","eligible":true或false}],"skipped":[{"title":"查了但没入的","why":"为什么"}]}

- cards 最多 ${cap} 条，宁缺毋滥；按匹配度从高到低排。
- 一条都没有也要输出这一行（两个空数组）。
- 查过但没入的（vanity、要付钱领奖、无独立官网、已过截止、不对味）放进 skipped，一句话原因——负面结果也是信息。
- 链接填官方页面，不填聚合站的转载页。
- deadline_at 只在能定到具体某一天时才填；"spring 2027" 这种填 null，别猜一个。`
}

/** 整段提示词：任务自己那段 + 脑子补的尾巴。 */
export function fullPrompt(task, ctx) {
  return `${String(task.prompt || '').trim()}\n\n${tail({ ...ctx, cap: capOf(task) })}`
}

/** 一轮最多建几张。config.max_new，默认 5。 */
export function capOf(task) {
  const n = Number(task?.config?.max_new)
  return Number.isInteger(n) && n > 0 ? n : 5
}

/**
 * 从回复末尾解析 [[CARDS]]。
 * 解析不出返回 null（调用方要把这一轮记成「没跑成」，不能当成「没找到」——
 * 两者长得一样，但一个是它没按格式说话，一个是真没有）。
 */
export function parseCards(text) {
  const m = String(text || '').match(/\[\[CARDS\]\]\s*(\{[\s\S]*\})\s*$/)
  if (!m) return null
  let raw
  try { raw = JSON.parse(m[1]) } catch (_) { return null }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cards)) return null

  const cards = raw.cards
    .filter((c) => c && typeof c === 'object' && String(c.title || '').trim())
    .map((c) => ({
      title: String(c.title).trim(),
      kind: c.kind || null,
      org: c.org || null,
      location: c.location || null,
      funding: c.funding || null,
      deadline: c.deadline || null,
      deadline_at: isDate(c.deadline_at) ? c.deadline_at : null,
      opens_at: isDate(c.opens_at) ? c.opens_at : null,
      url: c.url || null,
      match_stars: c.match_stars === 3 || c.match_stars === 2 ? c.match_stars : null,
      why: c.why || null,
      notes: c.notes || null,
      eligible: c.eligible === false ? false : true,
    }))
  const skipped = (Array.isArray(raw.skipped) ? raw.skipped : [])
    .filter((s) => s && String(s.title || '').trim())
    .map((s) => ({ title: String(s.title).trim(), why: s.why || null }))
  return { cards, skipped, said: String(text).slice(0, m.index).trim() }
}

/**
 * 去重 + 排序 + 截断。
 *   dup  库里已有（按标题或链接，忽略大小写）——它没听「已有的不要报」那句
 *   over 超过上限没建的，按星级排在后面的那些
 */
export function pick(cards, existing = [], cap = 5) {
  const titles = new Set(existing.map((e) => norm(e.title)).filter(Boolean))
  const urls = new Set(existing.map((e) => normUrl(e.url)).filter(Boolean))
  const dup = [], fresh = []
  const seen = new Set()
  for (const c of cards || []) {
    const t = norm(c.title), u = normUrl(c.url)
    if (titles.has(t) || (u && urls.has(u)) || seen.has(t)) { dup.push(c); continue }
    seen.add(t)
    fresh.push(c)
  }
  // 稳定排序：星多的在前，同星按它报的顺序
  const sorted = fresh.map((c, i) => [c, i]).sort((a, b) => (b[0].match_stars || 0) - (a[0].match_stars || 0) || a[1] - b[1]).map((x) => x[0])
  return { take: sorted.slice(0, cap), over: sorted.slice(cap), dup }
}

/** 战报一行。写进 tasks.last_result，面板上「上次 · …」就是它。 */
export function report({ today, made = [], dup = [], skipped = [], over = [], cap = 5 }) {
  const names = (xs) => xs.map((c) => c.title).join(' · ')
  const parts = []
  parts.push(made.length ? `${today} 新增 ${made.length} 张：${names(made)}。` : `${today} 这轮没有新增合适机会。`)
  if (dup.length) parts.push(`库里已有、跳过 ${dup.length} 张：${names(dup)}。`)
  if (skipped.length) parts.push(`查了没建卡 ${skipped.length} 个：${skipped.map((s) => `${s.title}${s.why ? `（${s.why}）` : ''}`).join(' · ')}。`)
  if (over.length) parts.push(`超过一轮上限 ${cap} 张没建的 ${over.length} 个：${names(over)}（下次还会再看到）。`)
  return parts.join('\n')
}
