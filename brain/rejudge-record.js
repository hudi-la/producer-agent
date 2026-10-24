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
  // 2026-10-24：不再写 letter_verdicts（「要不要回」只由状态机判，见 server.js judgePass）
  await call('pa_recompute_touch', key)
  const marked = await call('pa_mark_judged', { ...key, p_upto: subject.upto })
  if (!marked) throw new Error('Judgment watermark was not saved')
}
