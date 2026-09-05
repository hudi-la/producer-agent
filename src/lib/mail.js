import { supa, BRAIN } from './backends.js'

// 全局邮件同步的前端侧。
//
// 分工跟 people.js 一样：
//  · **你的判断**（翻案）—— 浏览器直连走 anon。翻案是你的手，不该依赖脑子开着。
//  · **要去 Gmail 拉正文、要让模型写摘要**（认领）—— 走本机 sidecar。
//
// 所以脑子没开的时候，「等你点头」那一屏照样看得见、档案柜照样搜得动、
// 案照样翻得了；只有「认」那个按钮点不动。这比整页瞎掉强得多。

const rpc = async (fn, args) => {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { data, error } = await supa.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

/** 等你点头的：它判定是业务相关的真人或机构信箱，还没进通讯录。 */
export async function fetchGreetable() {
  if (!supa) return null
  const { data, error } = await supa.from('v_pa_greetable').select('*')
  if (error) throw new Error(error.message)
  return data || []
}

/**
 * 一伙人：一串信里好几个人来回说话，其中还有人没进通讯录。
 * 浏览器直连读——脑子没开也看得见；只有「收」那一下要脑子（走 adopt）。
 */
export const fetchGroups = () => rpc('pa_group_threads', { p_min_people: 5 })

/** 这串处理过了：collected（收了，note 是活动名）| skip（这串不算） */
export const markThread = (thread, mark, note = null) =>
  rpc('pa_mark_thread', { p_thread: thread, p_mark: mark, p_note: note })

/**
 * 档案柜：判掉的一个都不删，全在这儿。
 *
 * 这一页不是待办清单，你不需要清空它。它存在的意义是：万一它冤枉了一个
 * 真人，你搜得到、翻得了案。AI 静默判掉一个真人，跟丢了没有区别。
 */
export async function searchArchive(q, limit = 40) {
  if (!supa) return null
  let sel = supa.from('v_pa_verdict_archive').select('*')
  const s = (q || '').trim()
  if (s) sel = sel.or(`email.ilike.%${s}%,name.ilike.%${s}%,org.ilike.%${s}%,why.ilike.%${s}%`)
  const { data, error } = await sel.order('n', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return data || []
}

/** 档案柜的家底：判掉了多少、各是什么。搜之前先让你知道规模。 */
export async function archiveTally() {
  if (!supa) return null
  const { data, error } = await supa.from('v_pa_verdict_archive').select('verdict')
  if (error) throw new Error(error.message)
  const t = { person: 0, shared_box: 0, bulk: 0, machine: 0, unsure: 0 }
  for (const r of data || []) t[r.verdict] = (t[r.verdict] || 0) + 1
  return { ...t, total: (data || []).length }
}

/** 信箱同步现状：回填到哪了、上次收信什么时候。 */
export async function mailState() {
  if (!supa) return null
  const { data, error } = await supa.from('v_pa_mail_accounts').select('*')
  if (error) throw new Error(error.message)
  return data || []
}

/**
 * 翻案。写 decided_by='you'，此后**任何自动判定都覆盖不了它**——
 * 闸在 pa_verdict_upsert 里，不是嘱咐。
 */
export const overrideVerdict = (f) => rpc('pa_verdict_upsert', {
  p_email: f.email,
  p_verdict: f.verdict,
  p_business: f.business ?? null,
  p_why: f.why ?? null,
  p_name: f.name ?? null,
  p_org: f.org ?? null,
  p_role: f.role ?? null,
  p_decided_by: 'you',
})

/** 端到你面前过了就打个戳，下次别重复打扰。 */
export const markGreeted = (emails) => rpc('pa_mail_greeted', { p_emails: emails })

async function brain(path, body) {
  const r = await fetch(`${BRAIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  const out = await r.json().catch(() => null)
  if (!r.ok || !out || out.error) {
    const err = new Error(out?.error || `HTTP ${r.status}`)
    err.needsAuth = Boolean(out?.needs_auth)
    err.fix = out?.fix || null
    throw err
  }
  return out
}

/**
 * 点头：认下这个地址。
 *
 * 一次点头串起四件事——建人（或登记机构信箱）→ 认领地址（**它名下所有
 * 历史往来当场归位**）→ 去 Gmail 拉那几封的正文 → 写摘要进对话表。
 * 正文一直到这一刻才拉，这就是「按需」那条边界。
 */
export const adopt = (row) => brain('/mail/adopt', {
  email: row.email,
  kind: row.verdict === 'shared_box' ? 'org' : 'person',
  name: row.name || null,
  org: row.org || null,
  role: row.role || null,
  why: row.why || null,
  contact_id: row.contact_id || null,
})

/** 收全局新信（走 history.list，只拉变化的）。 */
export const syncMail = () => brain('/mail/sync', {})
