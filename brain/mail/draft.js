import { buildMime, toRaw, newMessageId } from './mime.js'
import { renderBody } from './render.js'
import { asAuthErrorIfItIs } from './auth.js'

// Same OAuth connection as reading and sending; no model rewrites the approved text.
export async function saveDraft({ gmail, from, fromName, to, cc, subject, body, replyTo = null, threadId = null, draftId = null }) {
  const { text, html } = renderBody(body)
  const raw = toRaw(buildMime({ from, fromName, to, cc, subject, text, html,
    messageId: newMessageId(from), inReplyTo: replyTo }))
  const args = { userId: 'me', requestBody: { message: { raw, ...(threadId ? { threadId } : {}) } } }
  try {
    const { data } = draftId
      ? await gmail.users.drafts.update({ ...args, id: draftId })
      : await gmail.users.drafts.create(args)
    if (!data?.id) throw new Error('Gmail 未返回草稿编号，请查看草稿箱再重试')
    return { draft_id: data.id, thread_id: data.message?.threadId || null }
  } catch (err) { throw asAuthErrorIfItIs(err) }
}
