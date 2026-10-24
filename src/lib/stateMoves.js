// 聊天里定的事（[[STATE]] 信封）落地之后，那张小卡上唯一的动作：撤回。
//
// 落地是 brain 做的（pa_apply_state_move 只给 service_role）；撤回是你的手，
// 走浏览器直连 anon —— 脑子开没开都撤得了。钥匙是气泡 id，笔靠
// meta.state_move.src_msg 找回来（0123）。
import { supa } from './backends.js'
import { t } from '../i18n/index.js'

export async function undoStateMove(msgId) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  const { data, error } = await supa.rpc('pa_undo_state_move', { p_src_msg: msgId })
  if (error) throw new Error(error.message)
  return data
}

/** 记忆那张小卡的撤回（0125）：线上的 memo 笔软删；人的关系记忆长回旧值。 */
export async function undoMemo(msgId) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  const { data, error } = await supa.rpc('pa_undo_memo', { p_src_msg: msgId })
  if (error) throw new Error(error.message)
  return data
}

/**
 * 采纳一条提醒建议（2026-10-24）。后台到点时提的、或闸门拦下的改动只是建议，
 * 你按「采纳」才落地。走 brain：落地口 pa_apply_state_move 只给它。
 */
export async function adoptStateMove(owner, msgId) {
  const { BRAIN, brainFetch } = await import('./backends.js')
  const r = await brainFetch(`${BRAIN}/state-move/adopt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(owner?.pursuitId ? { pursuit_id: owner.pursuitId } : { contact_id: owner?.contactId }), message_id: msgId }),
  })
  const out = await r.json().catch(() => null)
  if (!r.ok || !out || out.error) throw new Error(out?.error || `HTTP ${r.status}`)
  return out
}

/** 为什么这一条只是建议。键跟 brain/decisions.js 的 gate 原因一致。 */
export const GATE_TEXT = {
  background: '后台到点时提的，你不在场，等你看过再改',   // i18n-ok 当作 t() 的键用，译文在 en.pursuits-b.js
  'unverified-send': '理由里说「已发出」，但邮件记录里没找到这封信',   // i18n-ok 同上
}
