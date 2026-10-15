// 给模型翻信箱的工具——用脑子自己的 Gmail 授权(2026-10-06)。
//
// 个人版这几格一直借 claude.ai 的 Gmail 连接器(mcp__claude_ai_Gmail__*):模型拿那套工具去搜、读、建草稿。
// 线上学员没有那个连接器,但他们每人都授权过脑子自己的 Gmail(读信 + 发信 + 建草稿)——
// 所以同样四件事,换成脑子自己的工具做,而且 GPT / Gemini 也用得上(连接器只有 Claude 有)。
//
//   search_threads   按 Gmail 搜索语法找往来,回每串的最后一封是谁、什么时候、讲什么
//   get_thread       读一整串,每封带正文
//   get_message      读一封;只要 thread id 就别要正文
//   create_draft     建草稿。**只建不发**——发送不在这里,模型够不到(跟 send.js 同一条护栏)
//
// 工具按这一次对话现造:Gmail 客户端在外面造好传进来(闭包),不靠租户上下文——
// SDK 回调工具时不保证还在 withTenant 里。
import { defineTool, toSdkServer } from '../engine/tools.js'
import { z } from 'zod'
import { plainText } from './gmail.js'
import { buildMime, toRaw, newMessageId } from './mime.js'
import { renderBody } from './render.js'
import { asAuthErrorIfItIs } from './auth.js'

export const GMAIL_SERVER = 'gmail'
export const OWN_GMAIL_TOOLS = ['search_threads', 'get_thread', 'get_message', 'create_draft'].map((n) => `mcp__${GMAIL_SERVER}__${n}`)

const BODY_CAP = 6000          // 一封信的正文最多给这么多字;签名、引荐都在前面,后面多半是引用的旧信
const txt = (s) => ({ content: [{ type: 'text', text: s }] })
const hdr = (m, name) => (m.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ''

function brief(m, withBody) {
  const out = {
    id: m.id, threadId: m.threadId,
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : hdr(m, 'Date'),
    from: hdr(m, 'From'), to: hdr(m, 'To'), cc: hdr(m, 'Cc') || undefined, subject: hdr(m, 'Subject'),
    labels: (m.labelIds || []).filter((l) => ['SENT', 'INBOX', 'DRAFT'].includes(l)),
  }
  if (withBody) {
    const body = plainText(m.payload).trim()
    out.body = body.length > BODY_CAP ? body.slice(0, BODY_CAP) + `\n…(后面还有 ${body.length - BODY_CAP} 字,多半是引用的旧信)` : body
  } else out.snippet = m.snippet || ''
  return out
}

const guard = (fn) => async (args) => {
  try { return await fn(args) }
  catch (err) {
    const e = asAuthErrorIfItIs(err)
    return txt(e.name === 'MailAuthError' ? `Gmail 授权掉了:${e.message}` : `Gmail 那边出错了:${e.message}`)
  }
}

/** gmail = google.gmail 客户端;me = 授权的地址;fromName = 草稿上的署名 */
export function gmailToolsServer({ gmail, me, fromName = '' }) {
  return toSdkServer(GMAIL_SERVER, [
    defineTool({
      name: 'search_threads',
      description: '按 Gmail 搜索语法找往来(比如 `from:a@x.org OR to:a@x.org`、`Descanso newer_than:1y`)。回每串的 id、几封、最后一封是谁什么时候发的、摘要。要正文再用 get_thread。',
      shape: { query: z.string().describe('Gmail 搜索语法'), max: z.number().optional().describe('最多几串,默认 10,最多 25') },
      handler: guard(async ({ query, max }) => {
        const { data } = await gmail.users.threads.list({ userId: 'me', q: query, maxResults: Math.min(Math.max(Number(max) || 10, 1), 25) })
        const list = data.threads || []
        if (!list.length) return txt(`没搜到:${query}`)
        const rows = []
        for (const t of list) {
          const { data: th } = await gmail.users.threads.get({ userId: 'me', id: t.id, format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'] })
          const msgs = th.messages || []
          rows.push({ threadId: t.id, messages: msgs.length, last: brief(msgs.at(-1) || {}, false) })
        }
        return txt(JSON.stringify(rows, null, 1))
      }),
    }),
    defineTool({
      name: 'get_thread',
      description: '读一整串往来,按时间排,每封带正文(签名、引荐都在正文里)。',
      shape: { thread_id: z.string() },
      handler: guard(async ({ thread_id }) => {
        const { data } = await gmail.users.threads.get({ userId: 'me', id: thread_id, format: 'full' })
        return txt(JSON.stringify((data.messages || []).map((m) => brief(m, true)), null, 1))
      }),
    }),
    defineTool({
      name: 'get_message',
      description: '读一封信。只要它属于哪个 thread 就把 with_body 设成 false。',
      shape: { message_id: z.string(), with_body: z.boolean().optional().describe('要不要正文,默认要') },
      handler: guard(async ({ message_id, with_body }) => {
        const full = with_body !== false
        const { data } = await gmail.users.messages.get({ userId: 'me', id: message_id, format: full ? 'full' : 'metadata', ...(full ? {} : { metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'] }) })
        return txt(JSON.stringify(brief(data, full), null, 1))
      }),
    }),
    defineTool({
      name: 'create_draft',
      description: `在 ${me} 的 Gmail 草稿箱里建一封草稿。**只建不发**——没有发送这回事。要回复某封信就给 reply_to_message_id(那封的 Gmail id),草稿会挂进那一串、主题和引用头自动接上。正文原样放,用 markdown 写的粗体、列表会排好版。`,
      shape: {
        to: z.array(z.string()).describe('收件人地址'),
        cc: z.array(z.string()).optional(),
        subject: z.string(),
        body: z.string().describe('正文,原样'),
        reply_to_message_id: z.string().optional().describe('回复哪封(Gmail message id);新起一封就不给'),
      },
      handler: guard(async ({ to, cc, subject, body, reply_to_message_id }) => {
        let threadId = null, inReplyTo = null, refs = null
        if (reply_to_message_id) {
          const { data: orig } = await gmail.users.messages.get({ userId: 'me', id: reply_to_message_id, format: 'metadata', metadataHeaders: ['Message-ID', 'References'] })
          threadId = orig.threadId || null
          inReplyTo = hdr(orig, 'Message-ID') || null
          refs = [...String(hdr(orig, 'References')).split(/\s+/).filter(Boolean), ...(inReplyTo ? [inReplyTo] : [])]
        }
        const { text, html } = renderBody(body)
        const raw = toRaw(buildMime({ from: me, fromName, to, cc, subject, text, html, messageId: newMessageId(me), inReplyTo, refs }))
        const { data } = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw, ...(threadId ? { threadId } : {}) } } })
        return txt(JSON.stringify({ draft_id: data.id, thread_id: data.message?.threadId || threadId, to: to.join(', ') }))
      }),
    }),
  ])
}
