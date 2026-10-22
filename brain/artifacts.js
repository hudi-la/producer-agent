import { messageLetters, matchesArtifact } from '../src/lib/messageLetters.js'
export { matchesArtifact }
// Materialize one message's artifact once; never overwrite another message's edited draft.
export function artifactFields(message, index = 0) {
  const letter = messageLetters({ ...message, role: 'producer' }).letters.find(x => x.index === index)?.letter
  const form = message?.meta?.form
  if (letter) return { p_kind: 'email', p_title: letter.subject, p_body: letter.body,
    p_meta: { to: letter.to, reply_to: letter.reply_to || null, thread_id: letter.thread_id || null,
      summary: letter.summary || null, artifact_message_id: message.id, ...(index ? { artifact_index: index } : {}) } }
  if (form && index === 0) return { p_kind: 'form', p_title: form.title,
    p_rules: { fields: form.fields.map(({ a, ...field }) => field) },
    p_meta: { artifact_message_id: message.id,
      answers: Object.fromEntries(form.fields.map(f => [f.key, f.a || ''])) } }
  throw new Error('这条消息没有邮件或表单产出')
}

// Tenant marks are stable across requests, while different owners never share locks.
export function artifactRunsFor(context) {
  if (!context?.marks) throw new Error('Artifact operation requires tenant context')
  return context.marks.artifactRuns ??= new Map()
}
