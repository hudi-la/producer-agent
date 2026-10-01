// 每周找机会那一轮：拼提示词、解析信封、去重、判门槛、写战报。
//
// 这儿只有纯函数（跟 timer.js / judge.js / reach.js 一个分工）；
// 调模型、认领任务、写库在 server.js 的 scoutPass。
//
// 分工的边界就是骨架 / 血肉的边界：
//   · 任务的 prompt（画像、来源、筛选规则）是血肉，存在 producer.tasks.prompt，他在面板里改
//   · 这个文件补的尾巴（今天几号、池子里已有哪些、按什么格式报）是骨架，他改不到也不用改
//
// ══ 一轮三步（2026-09-03 改）══════════════════════════════════
//   ① 复查池子   表里那些机会，开了没有
//   ② 出去找新的  聚合源 + 搜索，找到的**进池子**，不直接造卡
//   ③ 挑         本轮开着的里面，够格的造卡；其余留在池子里等他捡
//
// 设计稿：docs/specs/2026-09-03-opportunity-pool-design.md 第六节

export const CARDS_MARK = '[[CARDS]]'
export const CHECKS_MARK = '[[CHECKS]]'

const norm = (s) => String(s || '').trim().toLowerCase()
const normUrl = (s) => norm(s).replace(/\/+$/, '')
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const day = (x) => (x ? String(x).slice(0, 10) : '')

// ── 一轮的几个上限。都在 tasks.config 里，他在面板上改得到 ──────────
//
// 三个上限管三件不同的事，别混：
//   check_per_round  复查几行   —— 表会长到几百行，全查一遍又慢又贵
//   reach_per_round  判几个够得着 —— 每个都要联网翻往届名单，最贵的一步
//   card_cap         最多造几张卡 —— **安全阀，不是名额**（见 pickable）
const num = (v, dflt) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : dflt)
export const checkCapOf = (t) => num(t?.config?.check_per_round, 20)
export const reachCapOf = (t) => num(t?.config?.reach_per_round, 8)
export const cardCapOf = (t) => num(t?.config?.card_cap, 12)

// ══ 第一步 · 复查 ═══════════════════════════════════════════════

/** 一批要复查的行 → 一次调用。批太大它会漏行，太小又不停付底价。 */
export const CHECK_BATCH = 6

export function checkPrompt(rows, { today, tz }) {
  return `今天是 ${today}（${tz}）。下面 ${rows.length} 个机会在他的关注表里，**逐个去官网看现在开着没有**。

${rows.map((r, i) => `### ${i + 1}｜id=${r.id}
- 名称：${r.title}${r.org ? `\n- 机构：${r.org}` : ''}${r.kind ? `\n- 类型：${r.kind}` : ''}
- 表里记的截止：${r.deadline || '（没记）'}${r.deadline_at ? `（= ${day(r.deadline_at)}）` : ''}${r.opens_at ? `\n- 表里记的预计开放：${day(r.opens_at)}` : ''}
- 链接：${r.url || '（没有，自己搜官网）'}`).join('\n\n')}

## 逐个查这几件事
1. 官网上**这一轮**现在接不接受申请？（open = 现在就能投；closed = 关着或还没开）
2. 真实截止日期。聚合站和旧记录上的常是上一届残留，**以官网为准**。
3. 关着的话，下一轮预计什么时候开？官网说了就填 opens_at，没说就留 null，**别猜**。

## 铁律
- **一个都不许跳过。** 打不开官网、找不到页面，就答 status="unknown" 并在 note 里说清为什么。
  静默漏掉一行，跟「查了没变化」长得一模一样，那是最难发现的错。
- 日期只在能定到具体某一天时才填。"spring 2027" 这种填 null，原话写进 deadline。
- note 一句话，说人话，比如「2027 轮 10 月 1 日开放，官网已挂公告」「页面 404，机构可能停办」。

## 报法
先用两三句话说这一批的大概。然后**最后一行**单独输出，别的什么都不要加在它后面：
${CHECKS_MARK} {"checks":[{"id":"上面那个 id 原样抄回来","status":"open|closed|unknown","deadline":"官方原话或null","deadline_at":"YYYY-MM-DD或null","opens_at":"YYYY-MM-DD或null","note":"一句话"}]}
一共 ${rows.length} 条，**一条都不能少**。`
}

/** 解析复查结果。解析不出返回 null；解析出来的按 id 索引。 */
export function parseChecks(text) {
  const m = String(text || '').match(/\[\[CHECKS\]\]\s*(\{[\s\S]*\})\s*$/)
  if (!m) return null
  let raw
  try { raw = JSON.parse(m[1]) } catch (_) { return null }
  if (!raw || !Array.isArray(raw.checks)) return null
  return raw.checks
    .filter((c) => c && typeof c === 'object' && c.id)
    .map((c) => ({
      id: String(c.id),
      status: ['open', 'closed', 'unknown'].includes(c.status) ? c.status : 'unknown',
      deadline: c.deadline || null,
      deadline_at: isDate(c.deadline_at) ? c.deadline_at : null,
      opens_at: isDate(c.opens_at) ? c.opens_at : null,
      note: c.note || null,
    }))
}

// ══ 第二步 · 出去找新的 ═════════════════════════════════════════

/**
 * 脑子补在任务 prompt 后面的那段。
 * existing = [{title, org}]：池子和看板上已经有的，让它别再报。
 *
 * **落点是池子，不是卡**（2026-09-03 改），所以这儿不再说「每周最多 5 个」——
 * 池子里多几行不花钱，而且他明说了「表里面可以多，不讲宁缺毋滥」。
 * 造几张卡是第三步按门槛定的事，跟这儿无关。
 */
export function tail({ today, tz, existing = [] }) {
  const have = existing.length
    ? existing.map((e) => `- ${e.title}${e.org ? ` · ${e.org}` : ''}`).join('\n')
    : '（表里还没有东西）'
  return `== 今天是 ${today}（${tz}）==
截止日期按今天算。**已经过了截止、而且不会再开的，不用报。**

== 表里已经有这些，已有的不要再报 ==
${have}

== 这一步是往「关注表」里加行，不是直接造卡 ==
所以**不设条数上限**：按画像筛得过的都报上来，当前没开放的也报（注明预计什么时候开）。
造哪几张卡是后面一步按「够不够得着」定的，不用你在这儿挑。
但仍然只报**筛得过**的：不对味的、明显 vanity 的（高报名费 + 含糊奖项、要为领奖付钱、
无独立官网）不要报，把它们放进 skipped 并写清原因。

== 报法 ==
先用简洁${process.env.FAIRWIND_LANG === 'en' ? '英文' : '中文'}说这轮扫了哪些源、看到了什么，三五句就够。
然后**最后一行**单独输出，别的什么都不要加在它后面：
${CARDS_MARK} {"cards":[{"title":"机会名称","kind":"驻地|grant|奖|群展|开放征集|…","org":"机构","location":"地点","funding":"资助内容","deadline":"截止的官方原话或null","deadline_at":"YYYY-MM-DD或null","opens_at":"YYYY-MM-DD或null（当前未开放时填预计开放日）","url":"官方链接","status":"open或closed（现在接不接受申请）","match_stars":3或2,"why":"${process.env.FAIRWIND_LANG === 'en' ? 'one-line reason in English' : '中文一句话理由'}","notes":"英文 notes，可空","eligible":true或false}],"skipped":[{"title":"查了但没入的","why":"为什么"}]}

- 一条都没有也要输出这一行（两个空数组）。
- 链接填官方页面，不填聚合站的转载页。
- deadline_at 只在能定到具体某一天时才填；"spring 2027" 这种填 null，别猜一个。
- eligible=false 的（限美国公民 / 绿卡 / 需当地工作权）**照报**，我们会标成资格搁置留着。`
}

// ── 画像从档案来(2026-09-17)────────────────────────────────
// 学员出厂的那条任务(0143)提示词里不写任何人的名字,画像那段是一个占位符 {{画像}},
// 跑的时候换成「我的档案」里的东西:身份、常住、阶段、资助偏好、排除/关注规则、母题、作品。
// 他自己那条提示词里画像是手写的、没有占位符——原样不动。
export const PROFILE_SLOT = '{{画像}}'

const line = (k, v) => {
  if (v == null) return null
  const t = Array.isArray(v) ? v.filter(Boolean).join(' / ') : String(v).trim()
  return t ? `- ${k}:${t}` : null
}

/** 档案 → 画像那一段。什么都没填时明说,别让模型替 ta 假设。 */
export function profileBlock({ profile, concerns = [], works = [] } = {}) {
  const d = profile?.data || {}
  const rows = [
    line('名字', profile?.name), line('作品站', profile?.website),
    line('身份/签证', d.visa), line('常住', d.location), line('阶段', d.career_stage),
    line('资助偏好', d.funding_pref),
    line('【排除规则】满足的照报,但 eligible=false', d.exclude_rule),
    line('【关注规则】满足的哪怕没开放也报,status 填 closed、opens_at 填预计开放日', d.watch_rule),
    line('母题', concerns),
    line('作品', works.map((w) => `『${w.title}』${w.medium ? `(${w.medium})` : ''}`)),
  ].filter(Boolean)
  return rows.length ? rows.join('\n')
    : '(档案还没填——只报「明确对所有人开放、无资格限制」的机会,notes 注明「档案未填,粗筛」)'
}

/** 整段提示词：任务自己那段（{{画像}} 换成档案）+ 脑子补的尾巴。 */
export function fullPrompt(task, ctx) {
  const body = String(task.prompt || '').trim().split(PROFILE_SLOT).join(profileBlock(ctx))
  return `${body}\n\n${tail(ctx)}`
}

/** 从回复末尾解析 [[CARDS]]。解析不出返回 null（「没按格式报」≠「没找到」）。 */
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
      status: c.status === 'open' ? 'open' : c.status === 'closed' ? 'closed' : 'unknown',
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
 *   dup  表里已有（按标题或链接，忽略大小写）—— 它没听「已有的不要报」那句
 *   over 超过上限没收的（进池子这一步默认没上限）
 */
export function pick(cards, existing = [], cap = Infinity) {
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
  const sorted = fresh
    .map((c, i) => [c, i])
    .sort((a, b) => (b[0].match_stars || 0) - (a[0].match_stars || 0) || a[1] - b[1])
    .map((x) => x[0])
  return { take: sorted.slice(0, cap), over: sorted.slice(cap), dup }
}

// ══ 第三步 · 挑 ═════════════════════════════════════════════════

/**
 * 造卡的门槛。**这是判据，不是名额** —— 他 2026-09-03 的原话：
 * 「没有必要每周自动就只默认三张。如果说非常合适的就很多的话，你就多几张。」
 *
 * 够格 = 方向很准且不是多半白投，或者方向中等但确实够得着：
 *   fit ★★★ 且 reach ≠ longshot
 *   fit ★★  且 reach = realistic
 *
 * reach 是 null / 'unknown'（往届名单没查到）时当作「不是 longshot」——
 * **存疑不降级**。查不到名单就把一个 ★★★ 的开放机会埋进池子，比多给他一张卡坏得多。
 *
 * cap 只是安全阀，防跑飞。触发了必须在战报里说出来（见 report3），
 * 静默截断跟「就这么多」长得一样。
 */
export function pickable(rows, cap = 12) {
  const ok = (o) => {
    const r = o.reach || 'unknown'
    if (o.fit_stars === 3) return r !== 'longshot'
    if (o.fit_stars === 2) return r === 'realistic'
    return false
  }
  const rank = { realistic: 0, unknown: 1, stretch: 2, longshot: 3 }
  const good = [], hold = []
  for (const o of rows || []) (ok(o) ? good : hold).push(o)
  good.sort((a, b) =>
    (b.fit_stars || 0) - (a.fit_stars || 0)
    || (rank[a.reach || 'unknown'] ?? 1) - (rank[b.reach || 'unknown'] ?? 1)
    || String(a.deadline_at || '9999').localeCompare(String(b.deadline_at || '9999')))
  return { take: good.slice(0, cap), over: good.slice(cap), hold }
}

// ══ 战报 ════════════════════════════════════════════════════════

const names = (xs, n = 8) => {
  const list = (xs || []).map((c) => c.title)
  return list.slice(0, n).join(' · ') + (list.length > n ? ` …等 ${list.length} 个` : '')
}

/** 报错原文瘦成一句:模型接口回的 JSON 只留 message,再截到 160 字。战报是给人看的,不贴整段 JSON。 */
export function brief(msg) {
  let m = String(msg || '').replace(/\s+/g, ' ').trim()
  const j = m.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (j) m = (m.match(/^模型接口回 \d+/) || m.match(/^[^:\[{]{0,40}/) || [''])[0].replace(/[:：\s]+$/, '') + (j ? ':' + j[1].replace(/\\"/g, '"') : '')
  return m.length > 160 ? m.slice(0, 157) + '…' : m
}

/** 这一步是被什么停下的:没额度 / 型号下线 / 挤不上 / 别的。战报头一句按它说人话。 */
export function haltKind(msg) {
  const m = String(msg || '')
  if (/\b401\b|invalid bearer|failed to authenticate|api key not valid|invalid.?api.?key|incorrect api key/i.test(m)) return 'auth'
  if ((/429/.test(m) && /quota|billing/i.test(m)) || /usage limit|RESOURCE_EXHAUSTED/i.test(m)) return 'quota'
  if (/模型接口回 404|\b404\b/.test(m)) return 'model'
  if (/模型接口回 (429|5\d\d)/.test(m)) return 'busy'
  return 'error'
}
const STEP = { recheck: ['复查', 'recheck'], search: ['找新的', 'search'], judge: ['判够不够得着', 'reach judging'] }
/** 停下来的那一句:放在战报最上面,说清停在哪一步、为什么、接下来怎么办。已做完的部分不丢。 */
function haltLine(halts, en) {
  if (!halts?.length) return null
  const kinds = new Set(halts.map((h) => haltKind(h.why)))
  const steps = [...new Set(halts.map((h) => h.step))].map((s) => (STEP[s] || [s, s])[en ? 1 : 0]).join(en ? ', ' : '、')
  const why = brief(halts[0].why)
  if (kinds.has('auth')) return en
    ? `⚠️ The model wouldn't accept your key or login — this run stopped at: ${steps}. Go to Settings → Model source, clear that field and paste it again (Claude subscription: run claude setup-token again), Save, then "Run now". (${why})`
    : `⚠️ 模型不认你的 key / 登录——这轮停在：${steps}。去「设置 → 模型来源」把那一栏清空重新粘（Claude 订阅：重新跑一次 claude setup-token），保存后再点「现在跑一次」。（${why}）`
  if (kinds.has('quota')) return en
    ? `⚠️ The model ran out of quota — this run stopped at: ${steps}. What was finished is kept. Quota resets daily (Gemini free tier: midnight Pacific); press "Run now" again then, or add billing to the key. (${why})`
    : `⚠️ 模型没额度了——这轮停在：${steps}。做完的部分留着。额度每天重置（Gemini 免费档：太平洋时间零点），到时再点「现在跑一次」，或者给 key 开计费。（${why}）`
  if (kinds.has('model')) return en
    ? `⚠️ The model is no longer available — this run stopped at: ${steps}. Update Fairwind, or pick another model under Settings → Model source. (${why})`
    : `⚠️ 这个型号不能用了——这轮停在：${steps}。更新 Fairwind，或去「设置 → 模型来源」换一个。（${why}）`
  if (kinds.has('busy')) return en
    ? `⚠️ The model was overloaded — this run stopped at: ${steps}. Nothing is lost; try "Run now" again later. (${why})`
    : `⚠️ 模型那边挤不上——这轮停在：${steps}。没丢东西，过会儿再点「现在跑一次」。（${why}）`
  return en ? `⚠️ This run stopped at: ${steps}. (${why})` : `⚠️ 这轮停在：${steps}。（${why}）`
}

/** 三步各说一句。写进 tasks.last_result，面板上「上次」就是它。按 FAIRWIND_LANG 写中文或英文(学员首启选的语言)。 */
export function report3({
  today,
  checked = [], opened = [], closedNow = [], leftToCheck = 0,
  found = [], dupFound = [], skipped = [],
  judged = [], made = [], overCap = [], held = [], cardCap = 12, halts = [],
}) {
  const en = process.env.FAIRWIND_LANG === 'en'
  const L = [today]
  const hl = haltLine(halts, en); if (hl) L.push(hl)
  const sk = (s) => `${s.title}${s.why ? `（${brief(s.why)}）` : ''}`
  if (en) {
    L.push(checked.length
      ? `Rechecked ${checked.length}: ${opened.length} opened${opened.length ? ` (${names(opened)})` : ''}, ${closedNow.length} closed, ${checked.length - opened.length - closedNow.length} unchanged; ${leftToCheck} still waiting.`
      : 'Recheck: nothing due this round.')
    L.push(found.length ? `Found ${found.length} new, added to the pool: ${names(found)}.` : 'Search: nothing new this round.')
    if (dupFound.length) L.push(`Already in the pool, skipped ${dupFound.length}: ${names(dupFound)}.`)
    if (skipped.length) L.push(`Looked at but not added, ${skipped.length}: ${skipped.map(sk).join(' · ')}.`)
    if (judged.length) L.push(`Judged reach for ${judged.length}: ${judged.map((j) => `${j.title} → ${j.label}${j.why ? ` (${j.why})` : ''}`).join('; ')}.`)
    L.push(made.length ? `Made ${made.length} card${made.length > 1 ? 's' : ''}: ${names(made)}.` : 'No card qualified this round.')
    if (overCap.length) L.push(`${overCap.length} more qualified but not made this round (max ${cardCap} per round): ${names(overCap)}. Next round continues.`)
    if (held.length) L.push(`${held.length} open but below the card threshold, kept in the pool — pick them up yourself if you want: ${names(held)}.`)
    return L.join('\n')
  }
  L.push(checked.length
    ? `复查 ${checked.length} 行：${opened.length} 个开了${opened.length ? `（${names(opened)}）` : ''}，${closedNow.length} 个关了，${checked.length - opened.length - closedNow.length} 个没变；还有 ${leftToCheck} 行没轮到。`
    : `复查：这轮没有该查的行。`)
  L.push(found.length
    ? `找到 ${found.length} 个新的进表：${names(found)}。`
    : '找新的：这轮没有新的。')
  if (dupFound.length) L.push(`表里已有、跳过 ${dupFound.length} 个：${names(dupFound)}。`)
  if (skipped.length) L.push(`查了没收 ${skipped.length} 个：${skipped.map(sk).join(' · ')}。`)
  if (judged.length) {
    L.push(`判了 ${judged.length} 个够不够得着：${judged.map((j) => `${j.title} → ${j.label}${j.why ? `（${j.why}）` : ''}`).join('；')}。`)
  }
  L.push(made.length ? `造了 ${made.length} 张卡：${names(made)}。` : '这轮没有够格造卡的。')
  if (overCap.length) {
    L.push(`还有 ${overCap.length} 个够格但这轮没造（一轮最多 ${cardCap} 张）：${names(overCap)}。下轮继续。`)
  }
  if (held.length) L.push(`开着但没到造卡门槛的 ${held.length} 个，留在表里，想捡自己捡：${names(held)}。`)
  return L.join('\n')
}
