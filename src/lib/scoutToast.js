export function scoutToastState(tasks = [], now = Date.now()) {
  const candidates = tasks.filter((task) => task?.prompt && task.type?.startsWith('scout'))
  const task = candidates.find((x) => x.running_since)
    || candidates.find((x) => x.run_now)
    || candidates.find((x) => ['paused', 'failed'].includes(x.config?.scout_progress?.status))
    || candidates.find((x) => x.last_run_at && now - new Date(x.last_run_at).getTime() < 30 * 60_000)
  if (!task) return null
  const q = task.config?.scout_progress
  const remaining = (q?.units?.filter((x) => !x.done).length || 0)
    + (q?.candidates?.filter((x) => !x.done).length || 0) + (q?.stage === 'judge' ? q.judge_remaining || 0 : 0)
  const base = { id: task.id, name: task.name, done: q?.completed || 0, remaining, added: q?.added || 0,
    nextAt: task.enabled ? task.next_run_at : null, note: q?.note, updatedAt: q?.updated_at, lastRunAt: task.last_run_at }
  if (task.running_since) {
    if (now - new Date(task.running_since).getTime() > 2 * 60 * 60_000) return { ...base, kind: 'stalled' }
    return { ...base, kind: q?.completed ? 'resuming' : 'running' }
  }
  if (task.run_now) return { ...base, kind: 'queued' }
  if (q?.status === 'failed') return { ...base, kind: 'failed' }
  if (q?.status === 'paused') return { ...base, kind: 'paused' }
  return { ...base, kind: /⚠️|没跑成|failed|失败/i.test(task.last_result || '') ? 'failed' : 'complete' }
}
