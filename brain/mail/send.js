// 真的把信发出去。**纯 HTTP，一次模型都不过。**
//
// 这一层跟 gmail.js 是同一条分工线：那边把「抓取」和「理解」分开，这边把
// 「起草」和「发送」分开。信是模型写的，按下发送键的是他 —— 所以这个函数
// 只被 /mail/send 那个路由调用，而那个路由只被页面上那颗按钮触发。
//
// **它不在模型的工具白名单里**（server.js 的 READ_TOOLS / GMAIL_TOOLS 都没有
// 它）。「Fairwind 写得出信，但按不了发送键」那句话就是靠这一条兑现的：
// 模型够不到它，跟它够不到别条线的文件是同一种「够不到」—— 结构上做不到，
// 不是嘱咐。
import { asAuthErrorIfItIs } from './auth.js'
import { buildMime, toRaw, newMessageId } from './mime.js'
import { renderBody } from './render.js'

/**
 * 用错身份发出去的信，连道歉都没处发。
 *
 * 发错人还能补一封「抱歉发错了」；用**另一个账号**发出去的信，对方看到的是
 * 一个陌生地址，而你在自己的已发送里找不到它 —— 那封信在你这边等于不存在。
 * 所以这一条拦在最前面。
 *
 * 画像里没填邮箱就不拦：拦了等于没填过画像的人一封都发不出去，那是拿一个
 * 配置问题去挡一件真事。
 */
export function assertSameMailbox(authed, profileEmail) {
  const a = String(authed || '').trim().toLowerCase()
  const p = String(profileEmail || '').trim().toLowerCase()
  if (!p) return
  if (a !== p) {
    throw new Error(
      `授权的信箱（${a}）跟画像里填的（${p}）不是同一个。` +
      '要么改画像里那一格，要么在 brain 目录下跑 `npm run mail:auth` 换个账号授权。')
  }
}

/**
 * 发。
 *
 * ── **一次都不重试** ────────────────────────────────────────
 * gmail.js 里那套退避重试对「取」是对的：取失败了再取一次，最坏是多花点时间。
 *
 * 对「发」是错的 —— 一个超时的请求**可能已经发出去了**。重试等于同一封信
 * 发两遍，而收信人那头看到的是你连着发了两封一模一样的信。宁可把话说明白，
 * 让他自己去已发送里看一眼。
 */
export async function sendLetter({
  gmail, from, fromName, to, cc = null, subject, body,
  replyTo = null, refs = null, threadId = null,
}) {
  const messageId = newMessageId(from)
  const { text, html } = renderBody(body)
  // 组信在发之前：注入检查（mime.js 里的 noBreaks）要是抛了，一个字节都还没出去。
  const raw = toRaw(buildMime({
    from, fromName, to, cc, subject, text, html,
    messageId, inReplyTo: replyTo, refs,
  }))

  let data
  try {
    ;({ data } = await gmail.users.messages.send({
      userId: 'me',
      // threadId 给了才带：带一个空的会被当成挂到一个不存在的串上
      requestBody: { raw, ...(threadId ? { threadId } : {}) },
    }))
  } catch (err) {
    const authed = asAuthErrorIfItIs(err)
    if (authed.name === 'MailAuthError') throw authed
    const code = err?.response?.status ?? err?.code
    if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
        || (typeof code === 'number' && code >= 500)) {
      throw new Error(
        `发的时候断了（${code}）。**这封信可能已经发出去了** —— ` +
        '去 Gmail 的「已发送」里看一眼再决定要不要重发，别直接再按一次。')
    }
    throw err
  }

  if (!data?.id) {
    throw new Error('Gmail 没回 message id —— 这封信下落不明，去「已发送」里看一眼再说')
  }
  return { id: String(data.id), threadId: String(data.threadId || ''), messageId }
}
