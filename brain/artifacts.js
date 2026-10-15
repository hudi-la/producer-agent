// Materialize one message's artifact once; never overwrite another message's edited draft.
export function artifactFields(message) {
  const letter = message?.meta?.letter
  const form = message?.meta?.form
  if (letter) return { p_kind: 'email', p_title: letter.subject, p_body: letter.body,
    p_meta: { to: letter.to, reply_to: letter.reply_to || null, thread_id: letter.thread_id || null,
      summary: letter.summary || null, artifact_message_id: message.id } }
  if (form) return { p_kind: 'form', p_title: form.title,
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
