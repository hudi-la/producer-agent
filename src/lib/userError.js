import { getLang } from '../i18n/index.js'

export function errorText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return String(value.message || value.error_description || (value.error && errorText(value.error)) || value.code || 'Unknown error')
}

// Diagnostics can contain provider credentials, bridge URLs, or OAuth redirects.
export function safeErrorDetail(value) {
  return errorText(value)
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
      try { const u = new URL(url); u.username = ''; u.password = ''; u.search = ''; u.hash = ''; return u.toString() } catch { return '[URL]' }
    })
    .replace(/\b(?:sk-[\w-]+|AIza[\w-]+|eyJ[\w.-]+)/g, '[redacted]')
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, '$1 [redacted]')
    .replace(/((?:[\w-]*(?:token|secret|password|api[_-]?key)|authorization|code)["']?\s*[:=]\s*["']?)[^\s,"';}&]+/gi, '$1[redacted]')
    .slice(0, 1600)
}

const rules = [
  ['quota', /insufficient_quota|credit balance|billing|quota.*exceed|余额|额度.*(不足|用完)/i, '模型额度不足', '服务商拒绝了这次模型请求。请检查所选账号的余额或订阅额度，补充额度或在设置中切换模型来源后再试。', 'Model quota exhausted', 'Check the selected provider’s balance or subscription allowance. Add credit or change the model provider in Settings before trying again.'],
  ['auth', /401|invalid.*(?:key|token)|(?:key|token).*(?:invalid|expired)|authentication|unauthorized|invalid_grant|jwt.*expired|令牌.*(?:失效|过期)|未登录/i, '授权已失效或凭据不正确', '请重新登录对应服务；如果使用 API key 或订阅令牌，请到设置中重新填写并保存。MCP 令牌换过后，也需要更新 AI 工具里的连接配置。', 'Authorization failed', 'Sign in to the affected service again, or replace and save its API key or subscription token in Settings. If the MCP token changed, update the connection in your AI tool too.'],
  ['denied', /403|forbidden|permission|EACCES|EPERM|row.level.security|权限/i, '没有完成这项操作的权限', '请检查账号或文件夹的访问权限。在线服务的权限需要管理员开通；本机文件请选择可读写的目录。', 'Access denied', 'Check account or folder permissions. Ask the administrator for access to online resources, or choose a readable and writable local folder.'],
  ['rate', /429|rate.limit|too many requests|限流/i, '请求太频繁，服务暂时限流', '请稍等片刻再试，减少同时运行的任务；如果持续出现，请检查服务商的请求限制。', 'Too many requests', 'Wait a little before trying again and reduce concurrent tasks. Check the provider’s rate limits if this continues.'],
  ['model', /model.*(?:not.found|not.exist|unsupported|access|invalid)|模型.*(?:不存在|不支持|不可用)/i, '所选模型不可用', '请到设置检查模型名称，以及当前账号是否有权使用。可清空自定义模型名称，使用默认模型后再试。', 'Selected model unavailable', 'Check the model name and account access in Settings. Clear custom model names to use the default model, then try again.'],
  ['large', /413|too large|size.*limit|context.length|too many tokens|文件太大/i, '文件或内容超过限制', '请缩小文件、拆分内容或减少附件后再试。长对话可以另开一段。', 'File or content too large', 'Use a smaller file, split the content, or remove some attachments. Start a new conversation if the current one is too long.'],
  ['disk', /ENOSPC|disk.*full|磁盘.*满/i, '存储空间不足', '请释放磁盘或存储服务的空间，再重新上传或备份。', 'Storage is full', 'Free space on the disk or storage service before uploading or backing up again.'],
  ['file', /ENOENT|404|not.found|no such file|不存在/i, '找不到所需文件或服务', '文件可能已移动、删除，或连接地址不正确。请检查文件、备份目录或连接设置后再试。', 'File or service not found', 'Check whether the file moved or was deleted, and verify the backup folder or connection address.'],
  ['backup', /zip|archive|corrupt|备份.*(?:无效|损坏)/i, '备份文件无法读取', '请使用 Fairwind 导出的完整备份文件。恢复可能没有完成，请检查当前数据和附件，再选择可用备份；不要反复覆盖恢复。', 'Backup cannot be read', 'Use a complete backup exported by Fairwind. Recovery may be incomplete: inspect the current data and attachments before choosing another backup.'],
  ['timeout', /timeout|timed.out|超时|AbortError/i, '等待服务响应超时', '请检查网络和服务状态。操作可能已经在后台执行，先确认结果，再决定是否重试，避免重复提交。', 'Service response timed out', 'Check the connection and service status. The operation may have run in the background; check the result before retrying to avoid duplicates.'],
  ['network', /fetch|network|ECONN|ENOTFOUND|offline|连不上|无法连接|Load failed/i, '连接中断，无法确认操作结果', '请检查网络；本机版请确认 Fairwind 已打开。恢复连接后先检查操作结果，再重试。', 'Connection interrupted', 'Check the network; for the local version, make sure Fairwind is running. Check the operation’s result before retrying.'],
  ['server', /\b50[0-9]\b|529|overloaded|unavailable/i, '服务暂时无法处理请求', '请稍后再试。如果持续出现，请把下方诊断信息交给管理员或服务商。', 'Service temporarily unavailable', 'Try again later. If this continues, share the diagnostic details below with your administrator or provider.'],
  ['login', /provider.*not enabled|Unsupported provider|Signups not allowed|access_denied/i, '登录未完成', '请确认登录授权；如果服务尚未开通或账号未获准访问，请联系管理员。', 'Sign-in did not complete', 'Check the sign-in authorization. If the provider is not enabled or the account is not allowed, contact the administrator.'],
  ['format', /invalid.response|Unexpected token|JSON|格式|不能为空|required/i, '输入或服务返回的内容无法处理', '请检查必填内容和文件格式。如果输入无误仍然失败，请联系管理员并提供诊断信息。', 'Input or response could not be processed', 'Check required fields and file formats. If your input is correct, share the diagnostic details with the administrator.'],
]

export function describeError(error, context = '') {
  const raw = errorText(error)
  const match = rules.find(([, re]) => re.test(`${error?.status || ''} ${raw}`))
  const en = getLang() === 'en'
  return {
    kind: match?.[0] || 'unknown',
    title: match ? match[en ? 4 : 2] : (en ? 'Operation did not complete' : '这次操作没有完成'),
    action: match ? match[en ? 5 : 3] : (en ? 'Check the details below. Verify the current result before trying again; if this continues, share these details with the administrator.' : '请查看下方具体原因，先确认当前结果再重试；如果仍然失败，请把诊断信息交给管理员。'),
    context, detail: safeErrorDetail(error),
  }
}
