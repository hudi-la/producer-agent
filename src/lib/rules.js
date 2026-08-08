// 规则层 —— 死规则，前端自己算，实时的。
//
// 为什么不交给 AI：Solitude 要 1000–1500 字符、bio 400 字符、PDF ≤10 页 / 10MB；
// CultureHub 要 50–100 词、6 样素材。这些是数出来的，不是判断出来的。
// 让 AI 去猜，它会猜错，而且要等它跑完你才知道。
//
// 规则没过 → 「定稿」是灰的。所以这一层不是提醒，是闸。
// 判断层（"你把 liminal 换成 threshold 了"）是另一回事，那个不拦人。

const WORD_RE = /\S+/g

export function countWords(s) {
  return (String(s || '').match(WORD_RE) || []).length
}

export function countChars(s) {
  return String(s || '').length
}

/**
 * rules 的形状（jsonb，存在 deliverables.rules）：
 *   { chars: [min, max] }      正文字符数
 *   { words: [min, max] }      正文词数（英文）
 *   { items: ["公开用名", …] } 必填清单；勾选状态存在 meta.done = ["公开用名"]
 *   { mb: 10, pages: 10 }      文件类；实际值存在 meta.mb / meta.pages
 *
 * 返回 { checks: [{key,label,ok,detail}], allOk }
 * 没有规则 = 没有闸，allOk 为 true。
 */
export function checkRules(rules, body, meta, opts = {}) {
  const r = rules || {}
  const m = meta || {}
  const checks = []

  // 空的定不了稿。
  // 这条不写在 rules 里，因为它不是哪个机构的要求，是「定稿」这个词本身的意思——
  // 一份空白的东西没有稿可定。（chars:[0,400] 这种上限型规则，0 字符是合法的，
  // 所以光靠 rules 拦不住，会让你定出一份空稿来。）
  if (opts.needsBody) {
    const n = countChars(String(body || '').trim())
    if (n === 0) {
      checks.push({ key: 'empty', label: '还是空的', ok: false, detail: '写点东西才谈得上定稿' })
      return { checks, allOk: false }
    }
  }

  if (Array.isArray(r.chars)) {
    const [min, max] = r.chars
    const n = countChars(body)
    checks.push({
      key: 'chars',
      label: `${n} / ${max} 字符`,
      ok: n >= (min || 0) && n <= max,
      detail: min ? `要求 ${min}–${max}` : `上限 ${max}`,
    })
  }

  if (Array.isArray(r.words)) {
    const [min, max] = r.words
    const n = countWords(body)
    checks.push({
      key: 'words',
      label: `${n} 词`,
      ok: n >= (min || 0) && n <= max,
      detail: `要求 ${min}–${max}`,
    })
  }

  if (typeof r.pages === 'number') {
    const n = m.pages
    checks.push({
      key: 'pages',
      label: n == null ? `页数未填` : `${n} 页`,
      ok: typeof n === 'number' && n <= r.pages,
      detail: `≤ ${r.pages} 页`,
    })
  }

  if (typeof r.mb === 'number') {
    const n = m.mb
    checks.push({
      key: 'mb',
      label: n == null ? '大小未填' : `${n} MB`,
      ok: typeof n === 'number' && n <= r.mb,
      detail: `≤ ${r.mb} MB`,
    })
  }

  if (Array.isArray(r.items)) {
    const done = Array.isArray(m.done) ? m.done : []
    for (const it of r.items) {
      checks.push({ key: 'item:' + it, label: it, ok: done.includes(it), detail: null, item: true })
    }
  }

  return { checks, allOk: checks.every((c) => c.ok) }
}

/** 清单类产出的进度，给标题旁边那个 pill 用。没有清单就返回 null。 */
export function itemProgress(rules, meta) {
  if (!Array.isArray(rules?.items)) return null
  const done = Array.isArray(meta?.done) ? meta.done : []
  const hit = rules.items.filter((i) => done.includes(i)).length
  return { hit, total: rules.items.length }
}
