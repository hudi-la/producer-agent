// 「这段回复是一张填好的表」。
//
// 跟 letter.js 是同一个路子（共用 tag.js 摘标记），但判断的东西不一样：
// 信的要害是**收件人**，表的要害是**每一格自己的字数上限**。
//
// ── 为什么逐格的闸是这件事的核心 ──────────────────────────────
// 申请表的实质就是「Artist statement: max 300 words」「Project description:
// 1000–1500 characters」。这些是数出来的，不是判断出来的 —— rules.js 早就
// 会数，而且是前端实时算、不花模型。缺的只是把闸拆到每一格上。
//
// 所以这儿宁可丢闸也不丢格子：闸写坏了，那一格还能填、还能改，你自己心里
// 有数；格子丢了，那道题在界面上**根本不存在**，你到提交前一刻才会发现。
// 「信息还在但看不见」是这个仓库反复在治的那一种坏法。
import { createHash } from 'node:crypto'
import { takeTag, clean1 } from './tag.js'

/**
 * 一格的身份是**题目本身**，不是它排第几。
 *
 * 答案存在 meta.answers[key] 里。要是拿下标当 key，Fairwind 重写一版时
 * 多插一道题，后面所有答案就整体错位一格 —— 而错位之后每一格看起来都
 * 「有内容」，你不逐条读完发现不了。
 */
export const fieldKey = (q) =>
  'f' + createHash('sha1').update(String(q ?? '').trim().toLowerCase()).digest('hex').slice(0, 8)

/** [min, max]，两个都是数、下限不大于上限，才算一条闸。写反了当没写。 */
function limit(v) {
  if (!Array.isArray(v) || v.length !== 2) return undefined
  const [lo, hi] = v
  if (typeof lo !== 'number' || typeof hi !== 'number') return undefined
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined
  if (hi <= 0 || lo > hi) return undefined
  return [lo, hi]
}

export function extractForm(text) {
  const { clean, data: j } = takeTag(text, 'FORM')
  if (!j) return { clean, form: null }

  const fields = []
  for (const f of Array.isArray(j?.fields) ? j.fields : []) {
    const q = clean1(f?.q)
    if (!q) continue                       // 没题目的格子不是一道题
    const words = limit(f?.words)
    const chars = limit(f?.chars)
    fields.push({
      key: fieldKey(q),
      q,
      // 答案没写不是错：它可能只认出了题目，等你自己填
      a: String(f?.a ?? ''),
      ...(words ? { words } : {}),
      ...(chars ? { chars } : {}),
    })
  }

  // 一格都没有的表，收进产出也是一张点了没反应的卡
  if (!fields.length) return { clean, form: null }

  return { clean, form: { title: clean1(j?.title) || '未命名表单', fields } }
}
