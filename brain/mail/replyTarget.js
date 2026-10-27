// 这封信是在回复哪一封（2026-10-26）。
//
// 原来由模型在 [[LETTER]] 里自己填 reply_to（原信的 Message-ID）和 thread_id——可给它看的往来里
// 根本没有这两样，它填不出来。于是 Megha 那封「Re: Show Invitation」存成了「新起的一封」：
// 发出去不会接在原来那串里，抄送名单也算不出来。
//
// 现在按邮件记录（信头账本）判，不问模型：
//   · 在收件人发来的信里，找主题去掉 Re:/Fwd: 之后跟这封一样的，取最近那封
//   · 找到 → 回复它：reply_to = 它的 Message-ID，thread_id = 它的串号
//   · 没找到 → 不猜。标题像回信（Re: …）却找不到原信时，发送前拦下来说清楚
// 只读，规则判，不花模型钱。

const PREFIX = /^\s*(re|fw|fwd|aw|sv|回复|答复|转发)\s*[:：]\s*/i

/** 主题去掉回复 / 转发前缀，统一大小写和空白。 */
export function baseSubject(s) {
  let t = String(s || '')
  for (let i = 0; i < 5 && PREFIX.test(t); i++) t = t.replace(PREFIX, '')
  return t.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 标题看起来是一封回信。 */
export const looksLikeReply = (subject) => PREFIX.test(String(subject || ''))

const addr = (v) => String((Array.isArray(v) ? v[0] : v) || '').trim().toLowerCase()

/**
 * 从信头里挑出要回复的那一封。纯函数。
 * headers: [{ message_id, gmail_thread_id, from_email, counterpart_email, direction, subject, sent_at, is_draft }]
 * 返回 { reply_to, thread_id, gmail_message_id, sent_at } 或 null。
 */
export function pickReplyTarget({ to, subject, headers = [] }) {
  const who = addr(to)
  const want = baseSubject(subject)
  if (!who || !want) return null
  const theirs = headers
    .filter((h) => h && h.message_id && !h.is_draft && h.direction === 'in'
      && (String(h.from_email || '').toLowerCase() === who || String(h.counterpart_email || '').toLowerCase() === who)
      && baseSubject(h.subject) === want)
    .sort((a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')))
  const h = theirs[0]
  return h ? { reply_to: h.message_id, thread_id: h.gmail_thread_id || null, gmail_message_id: h.gmail_message_id || null, sent_at: h.sent_at || null } : null
}

/** 去信头账本里查（用当前这个人的会话，行级权限只给他自己的信）。 */
export async function findReplyTarget(db, { to, subject }) {
  const who = addr(to)
  if (!who || !baseSubject(subject)) return null
  const { data, error } = await db.from('v_pa_mail_processing_headers')
    .select('message_id,gmail_thread_id,gmail_message_id,from_email,counterpart_email,direction,subject,sent_at,is_draft')
    .or(`from_email.eq."${who.replace(/"/g, '')}",counterpart_email.eq."${who.replace(/"/g, '')}"`)
    .eq('direction', 'in')
    .order('sent_at', { ascending: false })
    .limit(50)
  if (error) throw new Error('查原信失败：' + error.message)
  return pickReplyTarget({ to: who, subject, headers: data || [] })
}
