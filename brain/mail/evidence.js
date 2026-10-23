// Gmail status is evidence; summaries cannot establish delivery.
export function mailEvidence(message, direction) {
  const labels = Array.isArray(message?.labelIds) ? message.labelIds : []
  if (labels.includes('DRAFT')) return 'draft'
  if (direction === 'out' && !labels.includes('SENT')) return 'unverified_outgoing'
  return 'verified'
}
export function bodyFallback(raw) {
  return (raw || '').trim().slice(0, 200) || '未读取到可用的邮件正文，暂不生成摘要。'
}
