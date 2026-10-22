// 对话里那封信 → 产出里那份待发信 → 真发出去。
//
// 分工跟 mail.js / deliverables.js 是同一条线：
//  · **你的手**（收进产出）—— 浏览器直连 anon。脑子没开的时候照样收得下、
//    照样在产出那儿改得动。
//  · **要动 Gmail 的**（真发）—— 走本机 sidecar。钥匙在它手上，
//    浏览器这头永远拿不到。
import { supa, BRAIN, brainFetch } from './backends.js'
import { t } from '../i18n/index.js'

const need = () => {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
}

/**
 * 把对话里那封信收成一份待发的 email 产出。
 *
 * 一个所有者只留一份：它在对话里改五版、你收五次，覆盖的是同一份。
 * 闸在 pa_adopt_letter 里，不是在这儿——前端少调一次不会漏，
 * 数据库那道才是真的。
 */
export async function adoptLetter(owner, letter, body) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  const { data, error } = await supa.rpc('pa_adopt_letter', {
    p_pursuit_id: owner?.pursuitId || null,
    p_contact_id: owner?.contactId || null,
    p_to: letter.to,
    p_subject: letter.subject,
    p_body: body,
    p_meta: {
      reply_to: letter.reply_to || null,
      thread_id: letter.thread_id || null,
      summary: letter.summary || null,
    },
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * 真发。
 *
 * 走 brain：Gmail 的钥匙在它手上。而且这个口**不在模型的工具白名单里**——
 * 「Fairwind 写得出信，但按不了发送键」那句话就是靠这一条兑现的：
 * 只有你在页面上按那一下才走到这儿。
 */
export async function sendLetterNow(owner, deliverableId) {
  const r = await brainFetch(`${BRAIN}/mail/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(owner?.pursuitId ? { pursuit_id: owner.pursuitId } : { contact_id: owner?.contactId }),
      deliverable_id: deliverableId,
    }),
  })
  const out = await r.json().catch(() => null)
  if (!r.ok || !out || out.error) {
    const err = new Error(out?.error || `HTTP ${r.status}`)
    // 授权掉了要认得出来：界面据此摆出那句「跑一次 npm run mail:auth」，
    // 而不是让你对着一句 HTTP 401 猜。
    err.needsAuth = Boolean(out?.needs_auth)
    err.fix = out?.fix || null
    throw err
  }
  return out
}

/**
 * 回这封信该发给谁 —— **从信头账本算，不问模型**。
 *
 * 2026-08-18 加的，起因是一次真用：Huntington 那封实际要回给两个人，
 * 而界面上只摆着模型挑出来的一个地址、抄送一个字都没有。于是那封信
 * 没法安心发 ——「我不确定是几个人」。
 *
 * 答案本来就在库里（mail_headers 存着原信的 from / to / cc，全带 RFC
 * Message-ID）。这跟 0060「找信是机械活」是同一条：**收件人猜错了是
 * 撤不回来的**，更不该交给模型。
 *
 * 返回 { found, sender, others, cc }；found=false 时带一句 why——
 * 交出一份空名单会跟「只回发件人」长得一样，那是在骗人。
 */
export async function replyRecipients(replyToMessageId) {
  need()
  const { data, error } = await supa.rpc('pa_reply_recipients', {
    p_message_id: replyToMessageId,
  })
  if (error) throw new Error(error.message)
  return data
}

/** 存你勾出来的收件人和抄送。to 空了数据库会当场拒（0071）。 */
export async function setRecipients(deliverableId, to, cc) {
  need()
  const { error } = await supa.rpc('pa_set_recipients', {
    p_id: deliverableId, p_to: to, p_cc: cc,
  })
  if (error) throw new Error(error.message)
  return { ok: true }
}
