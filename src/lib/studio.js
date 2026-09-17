// 档案里那张书桌（0127）。
//
// **一条一个对话**，永久累积，各记各的。这支管四件事：读这一条的对话、
// 「重说」撤掉说错的那句、切「在写 / 写完」、往某一栏加一条。
//
// 后三件**都是他自己的手**，所以走浏览器直连（跟 setBall / pa_set_entry 一路）：
// 脑子开没开，不该影响他整理自己的档案。
//
// 说话那件事走 useChat（owner 传 {kind:'studio', id:条目 id}）—— 跟机会线那页
// 用的是同一份实现，不是照抄的第二份。
//
// **这儿没有一支给 AI 的写入口，一支都没有。** 书桌上 Fairwind 写不了库：
// 它写的每个字都是稿子，进档案是他自己复制过去、在那一格里自己改的。
import { supa } from './backends.js'

const needDb = () => {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
}

/** 拉这一条的对话。没连库时返回 null（跟 fetchMessages 一个规矩）。 */
export async function fetchStudioThread(entryId) {
  if (!supa || !entryId) return null
  const { data, error } = await supa.rpc('pa_studio_thread', { p_entry_id: entryId })
  if (error) return null
  return data || []
}

/**
 * 「重开一轮」：在流里划一道线。返回那条线（空对话、或上一条已经是线时返回 null）。
 *
 * 线以上的照常摆在界面上 —— 往上滚就看得见。变的只有一件事：Fairwind 的
 * prompt 只读最后一道线以下的。**不存档、不藏起来**：藏起来就欠一个
 * 「翻旧对话」的界面，而没有那个界面时「存起来了」等于「丢了」。
 */
export async function restartStudio(entryId) {
  needDb()
  const { data, error } = await supa.rpc('pa_restart_studio', { p_entry_id: entryId })
  if (error) throw new Error(error.message)
  return data ?? null
}

/**
 * 「重说」：把他点的那句和它之后的对话撤掉。返回撤了几条。
 *
 * 撤掉的话库里还在（打了 deleted_at 的标），只是读面全部滤掉：界面看不见，
 * Fairwind 的 prompt 里也没有。后者才是重点——不然他以为撤干净了，
 * 它却仍在按那句错话想事情。
 */
export async function rewindStudio(msgId) {
  needDb()
  const { data, error } = await supa.rpc('pa_rewind_studio', { p_msg_id: msgId })
  if (error) throw new Error(error.message)
  return data ?? 0
}

/** 切「在写 / 写完」。在写的那几条外面写申请时翻不到，书桌上和档案页照常看得见。 */
export async function setEntryDraft(id, draft) {
  needDb()
  const { error } = await supa.rpc('pa_set_entry_draft', { p_id: id, p_draft: draft })
  if (error) throw new Error(error.message)
}

/**
 * 往这一栏加一条。返回新那条的 id。
 *
 * 新条目一律标着「在写」（库里那支写死的）：刚建的东西按定义没写完，
 * 不该被当成战绩用在一封真的申请里。
 */
export async function addEntry(kind, title) {
  needDb()
  const { data, error } = await supa.rpc('pa_add_entry', { p_kind: kind, p_title: title ?? null })
  if (error) throw new Error(error.message)
  return data
}
