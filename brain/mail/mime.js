// 把一封信组成 RFC 822 的样子。**纯函数，不碰网也不碰库**，所以测得了。
//
// 为什么不吞一个现成的库：要的就这么几个头，而这一步出错的方式很吓人 ——
// 主题编错了对方看见一串乱码；头里混进一个换行，等于让别人替你加一行 Bcc。
// 这些都得能被测试按住，所以宁可自己写一百行，也不吞一个黑盒。
import { randomUUID } from 'node:crypto'

/**
 * 非 ASCII 的头得编码（RFC 2047），否则对方看到的是一串乱码。
 * 纯 ASCII 的原样留着 —— 编了反而让信头难读，排查问题时多绕一道。
 */
export function encodeHeader(s) {
  const t = String(s ?? '')
  if (!/[^\x20-\x7E]/.test(t)) return t
  return `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=`
}

/**
 * 自己生成 Message-ID。
 *
 * 为什么不等 Gmail 告诉我们：发完当场要把这个头写进 mail_headers（0055 靠
 * 它认亲），而 send 的返回里没有 Message-ID，再去 get 一次是白跑一趟 ——
 * 而且那中间对方要是回得快，那封回信就找不到自己的线。
 */
export function newMessageId(fromAddr) {
  const domain = String(fromAddr).split('@')[1] || 'localhost'
  return `<${randomUUID()}@${domain}>`
}

// 头里出现换行 = 有人在往信头里塞别的头（最典型的是 Bcc）。
//
// 这不是「清理一下」的事，是**当场拒绝**：静悄悄删掉的话，那封信照样发出去了，
// 而你永远不知道它到底发给了谁。宁可这一封发不出去。
const noBreaks = (label, v) => {
  const t = String(v ?? '')
  if (/[\r\n]/.test(t)) throw new Error(`${label}里不许有换行：${JSON.stringify(t)}`)
  return t
}

// 每 76 字符折一行（RFC 2045）。不折的话有的邮件服务器会自己动手折，
// 折在哪儿它说了算，base64 被折坏就是一封解不开的信。
const b64 = (s) =>
  Buffer.from(String(s ?? ''), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')

export function buildMime({
  from, fromName, to, subject, text, html,
  messageId, inReplyTo = null, refs = null,
  date = new Date(), boundary = `b${randomUUID().replace(/-/g, '')}`,
}) {
  noBreaks('收件人', to)
  noBreaks('主题', subject)
  noBreaks('发信人', fromName)

  const h = [
    `From: ${fromName ? `${encodeHeader(fromName)} <${from}>` : from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${messageId}`,
  ]
  // 新起一封就一个都不许有：**空的 In-Reply-To 会让对方客户端挂到一个
  // 不存在的串上**，那封信在他那边看起来像是回复了什么，而那个什么没有。
  if (inReplyTo) h.push(`In-Reply-To: ${noBreaks('In-Reply-To', inReplyTo)}`)
  if (refs?.length) h.push(`References: ${refs.map((r) => noBreaks('References', r)).join(' ')}`)
  h.push('MIME-Version: 1.0')
  h.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)

  // 纯文本排在前面：multipart/alternative 的规矩是**后面的优先**，
  // 所以想让富文本客户端优先显示 html，html 就得在后面。反了的话对方看到的
  // 是纯文本版，粗体变成四个星号 —— Md.jsx 那条注释记的就是这个，
  // 区别是这一次那份丑的在**对方的信箱里**，你看不见也改不回来。
  //
  // 行尾一律 CRLF：只有 \n 的信头有的邮件服务器不认。
  return [
    ...h,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

/** Gmail 的 send 要 base64url。 */
export const toRaw = (mime) =>
  Buffer.from(mime, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
