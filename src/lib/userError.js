import { t } from '../i18n/index.js'

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

// 正则里的中文是拿来认后台/服务商报的中文错误的，不翻；给人看的两句走 t()，用到时才取（模块加载时语言还没定）。
const rules = [
  ['contact_exists', /contacts_email_uniq/i, () => t('这个邮箱已在通讯录中'), () => t('请在人际管理中按邮箱找到已有联系人。若刚才是在添加新人，请刷新列表后重试；若是在修改邮箱，请使用其他邮箱，或保留已有联系人。')],
  ['quota', /insufficient_quota|credit balance|billing|quota.*exceed|余额|额度.*(不足|用完)/i, () => t('模型额度不足'), () => t('服务商拒绝了这次模型请求。请检查所选账号的余额或订阅额度，补充额度或在设置中切换模型来源后再试。')],
  ['auth', /401|invalid.*(?:key|token)|(?:key|token).*(?:invalid|expired)|authentication|unauthorized|invalid_grant|jwt.*expired|令牌.*(?:失效|过期)|未登录/i, () => t('授权已失效或凭据不正确'), () => t('请重新登录对应服务；如果使用 API key 或订阅令牌，请到设置中重新填写并保存。MCP 令牌换过后，也需要更新 AI 工具里的连接配置。')],
  ['denied', /403|forbidden|permission|EACCES|EPERM|row.level.security|权限/i, () => t('没有完成这项操作的权限'), () => t('请检查账号或文件夹的访问权限。在线服务的权限需要管理员开通；本机文件请选择可读写的目录。')],
  ['rate', /429|rate.limit|too many requests|限流/i, () => t('请求太频繁，服务暂时限流'), () => t('请稍等片刻再试，减少同时运行的任务；如果持续出现，请检查服务商的请求限制。')],
  ['model', /model.*(?:not.found|not.exist|unsupported|access|invalid)|模型.*(?:不存在|不支持|不可用)/i, () => t('所选模型不可用'), () => t('请到设置检查模型名称，以及当前账号是否有权使用。可清空自定义模型名称，使用默认模型后再试。')],
  ['large', /413|too large|size.*limit|context.length|too many tokens|文件太大/i, () => t('文件或内容超过限制'), () => t('请缩小文件、拆分内容或减少附件后再试。长对话可以另开一段。')],
  ['disk', /ENOSPC|disk.*full|磁盘.*满/i, () => t('存储空间不足'), () => t('请释放磁盘或存储服务的空间，再重新上传或备份。')],
  ['file', /ENOENT|404|not.found|no such file|不存在/i, () => t('找不到所需文件或服务'), () => t('文件可能已移动、删除，或连接地址不正确。请检查文件、备份目录或连接设置后再试。')],
  ['backup', /zip|archive|corrupt|备份.*(?:无效|损坏)/i, () => t('备份文件无法读取'), () => t('请使用 Fairwind 导出的完整备份文件。恢复可能没有完成，请检查当前数据和附件，再选择可用备份；不要反复覆盖恢复。')],
  ['timeout', /timeout|timed.out|超时|AbortError/i, () => t('等待服务响应超时'), () => t('请检查网络和服务状态。操作可能已经在后台执行，先确认结果，再决定是否重试，避免重复提交。')],
  ['network', /fetch|network|ECONN|ENOTFOUND|offline|连不上|无法连接|Load failed/i, () => t('连接中断，无法确认操作结果'), () => t('请检查网络；本机版请确认 Fairwind 已打开。恢复连接后先检查操作结果，再重试。')],
  ['server', /\b50[0-9]\b|529|overloaded|unavailable/i, () => t('服务暂时无法处理请求'), () => t('请稍后再试。如果持续出现，请把下方诊断信息交给管理员或服务商。')],
  ['login', /provider.*not enabled|Unsupported provider|Signups not allowed|access_denied/i, () => t('登录未完成'), () => t('请确认登录授权；如果服务尚未开通或账号未获准访问，请联系管理员。')],
  ['format', /invalid.response|Unexpected token|JSON|格式|不能为空|required/i, () => t('输入或服务返回的内容无法处理'), () => t('请检查必填内容和文件格式。如果输入无误仍然失败，请联系管理员并提供诊断信息。')],
]

export function describeError(error, context = '') {
  const raw = errorText(error)
  const match = rules.find(([, re]) => re.test(`${error?.status || ''} ${raw}`))
  return {
    kind: match?.[0] || 'unknown',
    title: match ? match[2]() : t('这次操作没有完成'),
    action: match ? match[3]() : t('请查看下方具体原因，先确认当前结果再重试；如果仍然失败，请把诊断信息交给管理员。'),
    context, detail: safeErrorDetail(error),
  }
}
