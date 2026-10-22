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
