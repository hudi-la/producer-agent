// brain/quota.js —— 认出「模型额度用完了」,能读出什么时候重置就读出来(2026-10-07)。
//
// 他要的:第一次收信判地址要花不少 token,中途额度用完了,右下角得说「额度用完了,X 点重置」,
// 重置之后自己接着,不用人管。各家报法不一样:
//   Claude 订阅      「Claude AI usage limit reached|1759871234」(竖线后是 unix 秒)
//                    或新版「5-hour limit reached ∙ resets 3pm」
//   Claude API key   429 rate_limit_error(retry-after)/ 「credit balance is too low」(要充值,不会自己好)
//   GPT              429 insufficient_quota(要充值)/ 其他 429(限流,一会儿就好)
//   Gemini           429 RESOURCE_EXHAUSTED,常带 retryDelay「37s」
//
// 返回 null = 不是额度的事;否则 { kind, resetAt?, resetText?, topUp, message }:
//   resetAt   ISO 时间,读得出就有
//   resetText 读不成时间、但对方说了个「resets 3pm」之类,原样留着给人看
//   topUp     余额没了——要去充值,等是等不来的
export class QuotaError extends Error {
  constructor(info) { super(info.message); this.name = 'QuotaError'; this.quota = info }
}

const iso = (ms) => new Date(ms).toISOString()

export function quotaOf(errOrText, now = Date.now()) {
  if (!errOrText) return null
  if (errOrText instanceof QuotaError) return errOrText.quota
  const status = errOrText?.status ?? errOrText?.response?.status ?? null
  const text = typeof errOrText === 'string' ? errOrText
    : [errOrText.message, typeof errOrText.body === 'string' ? errOrText.body : (errOrText.body || errOrText.response?.data) ? JSON.stringify(errOrText.body || errOrText.response?.data) : ''].filter(Boolean).join(' ')
  const short = String(text).replace(/\s+/g, ' ').slice(0, 240)

  // 要充值的:等不来
  if (/credit balance is too low|insufficient_quota|billing|exceeded your current quota|payment required/i.test(text)) {
    return { kind: 'tokens', topUp: true, message: short }
  }
  // Claude 订阅:usage limit reached|<unix 秒>
  let m = /usage limit reached\|(\d{10,13})/i.exec(text)
  if (m) { const n = Number(m[1]); return { kind: 'tokens', topUp: false, resetAt: iso(n < 1e12 ? n * 1000 : n), message: short } }
  // 新版说法:「… limit reached ∙ resets 3pm」「resets at 15:00」
  m = /limit (?:reached|exceeded)[^\n]*?resets?\s+(?:at\s+)?([^\n.|"]+)/i.exec(text)
  if (m) return { kind: 'tokens', topUp: false, resetText: m[1].trim().slice(0, 40), resetAt: guessResetAt(m[1], now), message: short }
  // Gemini:retryDelay "37s" / Claude API:retry-after 秒
  const retry = /retry[-_ ]?(?:delay|after)["':\s]*"?(\d+(?:\.\d+)?)s?/i.exec(text)
  if (status === 429 || /rate.?limit|RESOURCE_EXHAUSTED|too many requests|overloaded|usage limit/i.test(text)) {
    const secs = retry ? Number(retry[1]) : 15 * 60     // 没说等多久:先按一刻钟
    return { kind: 'tokens', topUp: false, resetAt: iso(now + secs * 1000), guessed: !retry, message: short }
  }
  return null
}

/** 「3pm」「15:00」「3:30pm」→ 今天(过了就明天)那个点的 ISO。读不懂就 null,界面上原样显示 resetText */
export function guessResetAt(s, now = Date.now()) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(String(s || ''))
  if (!m) return null
  let h = Number(m[1]); const min = Number(m[2] || 0); const ap = (m[3] || '').toLowerCase()
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  const d = new Date(now); d.setHours(h, min, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.toISOString()
}
