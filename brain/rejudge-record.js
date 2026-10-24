// A judgment is complete only once every dependent write succeeds.
// This is fail-closed, not a transaction: successful partial writes may be retried.
// The watermark must describe the input snapshot, never the time inference ended.
export async function persistRejudgment(db, subject, verdict) {
  if (!subject.upto) throw new Error('Missing judgment snapshot watermark')
  const call = async (name, args) => {
    const { data, error } = await db.rpc(name, args)
    if (error) throw new Error(`${name}: ${error.message}`)
    return data
  }
  const key = { p_kind: subject.kind, p_id: subject.id }
  await call('pa_set_next_touch', { ...key, p_at: verdict.touch, p_why: verdict.why })
  if (subject.last_in_id) await call('pa_judge_letter', {
    p_gmail_message_id: subject.last_in_id, p_needs_reply: verdict.needs_reply,
    p_not_before: null, p_why: verdict.reply_why,
  })
  await call('pa_recompute_touch', key)
  const marked = await call('pa_mark_judged', { ...key, p_upto: subject.upto })
  if (!marked) throw new Error('Judgment watermark was not saved')
}
