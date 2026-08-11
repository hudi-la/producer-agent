// 邮件这条链跟库打交道的地方。
//
// 单独成文件，是为了让 sync.js / classify.js 里**只有逻辑，没有 RPC 名字**。
// 换句话说：0045 那批端口叫什么、参数长什么样，只活在这儿。
import { createClient } from '@supabase/supabase-js'

let _db = null
export function db() {
  if (_db) return _db
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('brain/.env 里缺 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY')
  _db = createClient(url, key, { auth: { persistSession: false } })
  return _db
}

const call = async (fn, args) => {
  const { data, error } = await db().rpc(fn, args)
  if (error) throw new Error(`${fn} 失败：${error.message}`)
  return data
}

/**
 * 我的信箱都有哪些，连游标一起。
 *
 * counterpart 的判据是「不是我**任何一个**地址的那一方」，所以这儿必须
 * 一次拿全——少登记一个地址，那个地址发出去的信会被当成别人发来的。
 *
 * 走 RPC 不走视图：history_id 是 Gmail 的内部序号，对人没意义，
 * 不该出现在 anon 能读的那个视图里。
 */
export const myAccounts = () => call('pa_mail_accounts_state')

export const upsertAccount = (address, label) =>
  call('pa_mail_account_upsert', { p_address: address, p_label: label ?? null })

export const putHeaders = (rows) => call('pa_mail_headers_upsert', { p_rows: rows })

export const setCursor = (accountId, historyId, backfilled = false) =>
  call('pa_mail_cursor', { p_account_id: accountId, p_history_id: historyId, p_backfilled: backfilled })

export const rulePass = () => call('pa_mail_rule_pass')

export const candidates = (limit = 50) => call('pa_address_candidates', { p_limit: limit })

export const putVerdict = (v) => call('pa_verdict_upsert', {
  p_email: v.email, p_verdict: v.verdict, p_business: v.business ?? null,
  p_why: v.why ?? null, p_name: v.name ?? null, p_org: v.org ?? null,
  p_role: v.role ?? null, p_decided_by: v.decided_by || 'fairwind',
})

export const toPromote = (email) => call('pa_mail_promote', { p_email: email })
export const markPromoted = (ids) => call('pa_mail_promoted', { p_ids: ids })
export const markGreeted = (emails) => call('pa_mail_greeted', { p_emails: emails })

/** 已经存了多少信头（报进度、判断要不要回填用）。 */
export async function headerCount(accountId) {
  const q = db().from('v_pa_mail_accounts').select('headers').eq('id', accountId).limit(1)
  const { data, error } = await q
  if (error) throw new Error('读不到信头数：' + error.message)
  return Number(data?.[0]?.headers || 0)
}
