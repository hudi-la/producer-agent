// 产出（右栏）—— 要交出去的东西。
//
// 分工跟 chat.js 一样，而且更严：
//  · 读、以及「你的手」（定稿 / 取消定稿 / 改草稿 / 新建 / 删草稿）—— 浏览器直连 anon，
//    走 0027 里那几个 security definer 函数。
//  · Fairwind 只有 pa_upsert_deliverable 一个口，且**只能碰 status='draft'**。
//    它没有定稿的口——「定稿」这个动作在数据库层面就只对你开放。
import { supa, BRAIN } from './backends.js'

/** 拉这条线的全部产出。没连库时返回 null。 */
export async function fetchDeliverables(pursuitId) {
  if (!supa) return null
  const { data, error } = await supa
    .from('v_pa_deliverables')
    .select('*')
    .eq('pursuit_id', pursuitId)
  if (error) return null
  return data
}

/** 定稿 / 取消定稿。定稿 = 从右栏搬到左栏，取消 = 搬回来接着改（同一份，不生第二个版本）。 */
export async function setFinal(id, final) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { error } = await supa.rpc('pa_set_final', { p_id: id, p_final: final })
  if (error) throw new Error(error.message)
  return { ok: true }
}

/** 你在页面上改草稿。已定稿的改不动——函数会拒，前端也不该给你改的机会。 */
export async function editDeliverable(id, { title, body } = {}) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { error } = await supa.rpc('pa_edit_deliverable', {
    p_id: id, p_title: title ?? null, p_body: body ?? null,
  })
  if (error) throw new Error(error.message)
  return { ok: true }
}

/** 你自己新建一份空的。 */
export async function newDeliverable(pursuitId, kind = 'file', title = '未命名') {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { data, error } = await supa.rpc('pa_new_deliverable', {
    p_pursuit_id: pursuitId, p_kind: kind, p_title: title,
  })
  if (error) throw new Error(error.message)
  return data
}

/** 删。只能删草稿——定稿的要先取消定稿，免得一按就没。 */
export async function deleteDeliverable(id) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { error } = await supa.rpc('pa_delete_deliverable', { p_id: id })
  if (error) throw new Error(error.message)
  return { ok: true }
}

/** 附件（左栏文件格里那些不是产出的东西：邮件附件、上传的 PDF）。 */
export async function fetchAttachments(pursuitId) {
  if (!supa) return null
  const { data, error } = await supa
    .from('v_pa_attachments')
    .select('*')
    .eq('pursuit_id', pursuitId)
    .order('created_at')
  if (error) return null
  return data
}

// ── 要伸到系统外面去的两件事，走本机 sidecar ──────────────────
// 浏览器碰不到 Gmail，也不该碰。这两个口在 brain 里，且 Fairwind 那边的
// 工具白名单里**根本没有 send**——发送这个能力不存在，不是被关掉的。

async function callBrain(path, payload) {
  let res
  try {
    res = await fetch(`${BRAIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (_) {
    throw new Error('Fairwind 的脑子没开 —— 另开一个终端跑 npm run brain')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `脑子出错了（${res.status}）`)
  return body
}

/**
 * 把一封信放进 Gmail 草稿箱。
 * **这不是定稿。** 它还留在右栏，状态变成「在草稿箱 · 等你按发送」；
 * 只有你在 Gmail 里真的发出去、下次收信把它当成一封真信收回来，
 * 它才归到左栏往来，球权也才跟着翻。
 */
export async function putInDraftbox(pursuitId, deliverableId) {
  return callBrain('/gmail-draft', { pursuit_id: pursuitId, deliverable_id: deliverableId })
}

/** 收信：只拉这条线登记过的 thread，不遍历你的信箱。 */
export async function syncMail(pursuitId) {
  return callBrain('/sync', { pursuit_id: pursuitId })
}
