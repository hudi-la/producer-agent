// Keep failures visible until that mailbox has completed a retry.
export function archiveFailures(previous = [], result = {}) {
  const pending = new Set(previous)
  for (const email of result.succeeded || []) pending.delete(email)
  for (const email of result.failed || []) pending.add(email)
  return [...pending]
}
export function archiveWarning(failures, english = false) {
  if (!failures?.length) return null
  return english
    ? { note: `Mail archiving failed for ${failures.length} mailbox(es)`, fix: 'Some received email is not yet in conversations. Fairwind will retry automatically.' }
    : { note: `${failures.length} 个邮箱的邮件归档失败`, fix: '部分已收到的邮件尚未进入对话。Fairwind 会自动重试，恢复后提醒会消失。' }
}
