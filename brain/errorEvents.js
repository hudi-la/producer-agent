// Shared allowlists only: raw messages, context, URLs and user content never cross this boundary.
export const ERROR_LOG_RELEASE = 'error-logs-20261004-1'
export const ERROR_KINDS = ['quota', 'auth', 'denied', 'rate', 'model', 'large', 'disk', 'file', 'backup', 'timeout', 'network', 'server', 'login', 'format', 'unknown']
export const ERROR_OPERATIONS = ['settings', 'model', 'auth', 'mcp', 'backup', 'files', 'chat', 'mail', 'contacts', 'modules', 'update', 'judgments', 'database', 'other']
export const ERROR_CODES = ['insufficient_quota', 'invalid_api_key', 'invalid_grant', 'context_length_exceeded', 'model_not_found', 'rate_limit_exceeded', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EACCES', 'EPERM', 'ENOSPC', 'ENOENT']
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function errorOperation(context = '') {
  const text = String(context)
  const rules = [
    ['mcp', /mcp|bridge|AI 工具/i], ['backup', /backup|备份|恢复/i],
    ['auth', /auth|login|sign.?in|登录|session/i], ['files', /files|upload|附件|上传|文件/i],
    ['chat', /chat|对话|conversation/i], ['model', /model|模型/i], ['judgments', /judgment|判据|判断/i],
    ['mail', /mail|邮件|收件人/i], ['contacts', /contact|联系人/i], ['modules', /module|模块/i],
    ['update', /update|更新/i], ['database', /database|数据库|\/db\//i], ['settings', /settings|setup|设置|语言/i],
  ]
  return rules.find(([, re]) => re.test(text))?.[0] || 'other'
}
export function statusKind(status) {
  return ({ 401: 'auth', 403: 'denied', 404: 'file', 408: 'timeout', 413: 'large', 429: 'rate', 507: 'disk' })[status] || (status >= 500 ? 'server' : 'unknown')
}
export function safeErrorEvent(input) {
  if (!input || typeof input.id !== 'string' || !UUID.test(input.id) || !ERROR_KINDS.includes(input.kind) || !ERROR_OPERATIONS.includes(input.operation)) return null
  // Reconstruct, never spread input: even innocent-looking fields may contain credentials/content.
  return { id: input.id, kind: input.kind, operation: input.operation,
    ...(typeof input.requestId === 'string' && UUID.test(input.requestId) ? { requestId: input.requestId } : {}),
    ...(Number.isInteger(input.status) && input.status >= 400 && input.status <= 599 ? { status: input.status } : {}),
    ...(ERROR_CODES.includes(input.code) ? { code: input.code } : {}),
    ...(typeof input.occurredAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.occurredAt) && Number.isFinite(Date.parse(input.occurredAt)) ? { occurredAt: input.occurredAt } : {}),
    release: input.release === ERROR_LOG_RELEASE ? ERROR_LOG_RELEASE : 'unknown' }
}
