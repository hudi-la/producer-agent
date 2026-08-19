// 这封信要不要回。
//
// 这是三层漏斗的**第三层**。前两层已经建好了（0045）：
//   ① mail_headers.bulk —— 信头里就看得出的群发 / no-reply，零成本
//   ② address_verdicts  —— 这个地址是不是真人，一地址一次
// 前两层挡掉的绝大多数根本到不了这儿。第三层要判的是真人写给你的、
// 但**不需要你回**的那些：「谢谢，回头见」「收到了，月底再联系」。
//
// ══ 为什么这个判断可以存下来 ═══════════════════════════════════
//
// 它只关于**那一封信的内容**，而信寄出去就不会再改，所以判一次永远算数。
// 跟 next_action 那种「全局现在该干什么」根本不是一回事——那种新事实一来
// 就分叉，正是这一刀要治的第一条病。
//
// 设计稿：docs/specs/2026-08-18-notifications-design.md 第五、六节

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * 从回复里摘出那一批判定。**解析不出来一律空数组。**
 *
 * 空数组的下场是「这批没判成，下次打开重判」，而不是「判成了不用回」——
 * 判不出来的时候一律当「要回」，这条规矩靠的就是这儿返回空。
 */
export function parseTriage(text) {
  const m = String(text || '').match(/\[\[TRIAGE\]\]\s*(\[[\s\S]*\])\s*$/)
  if (!m) return []
  let rows
  try { rows = JSON.parse(m[1]) } catch (_) { return [] }
  if (!Array.isArray(rows)) return []
  return rows
    // 缺 id 或缺 needs_reply 的丢掉。**一封坏的不带塌一批。**
    .filter((r) => r && typeof r.id === 'string' && typeof r.needs_reply === 'boolean')
    .map((r) => ({
      id: r.id,
      needs_reply: r.needs_reply,
      // 不是 'YYYY-MM-DD' 就当没给 —— 「下学期」进不了 date 列
      not_before: typeof r.not_before === 'string' && ISO_DAY.test(r.not_before)
        ? r.not_before : null,
      why: typeof r.why === 'string' && r.why.trim() ? r.why.trim() : '（没说理由）',
    }))
}

/** 一封信在提示词里长什么样。正文截断，够判就行。 */
const CUT = 1200
const one = (l) => `--- id: ${l.id}
${l.at || '?'} ${l.from || '对方'}：${l.subject || '（无主题）'}
${String(l.body || '').slice(0, CUT)}`

/**
 * 一次判一批。**一次请求判 N 封，比 N 次请求判 1 封便宜一个数量级。**
 */
export function triagePrompt(letters) {
  return `下面是 ${letters.length} 封刚收到的信。每一封只答两个问题。

问题一：这封信**需要你回**吗？
需要回 = 里面有等你答的事（问题、邀约、要材料、约时间）。
不需要回 = 客套收尾（「谢谢，回头见」）、单纯的确认（「收到了」）、
通知类的告知。**拿不准就算需要回**——漏一封真信比多吵一条坏得多。

问题二：需要回的话，**是不是现在**？
他信里明说了时间锚点（「circle back next semester」「月底再联系」），
就给一个 YYYY-MM-DD；没说就 null。**日子必须是他信里说的，不许你编。**

${letters.map(one).join('\n\n')}

**最后一行**单独输出，别的什么都不要加：
[[TRIAGE]] [{"id":"<上面那个 id>","needs_reply":true|false,"not_before":"YYYY-MM-DD"|null,"why":"一句话，20 字内，说清凭什么这么判"}]`
}
