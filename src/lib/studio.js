// 档案里那张书桌（0127）。
//
// 一栏一条对话，永久累积，各记各的。这支管四件事：读这一栏的对话、
// 「重说」撤掉说错的那句、切「在写 / 写完」、往这一栏加一条。
//
// 后三件**都是他自己的手**，所以走浏览器直连（跟 setBall / pa_set_entry 一路）：
// 脑子开没开，不该影响他整理自己的档案。
//
// 说话那件事走 chat.js 的 sendMessageStream（owner 传 {kind:'studio', id:栏}）——
// 那边的流式、终止、乐观插入一样都不用重做。
//
// **这儿没有一支给 AI 的写入口，一支都没有。** 书桌上 Fairwind 写不了库：
// 它写的每个字都是稿子，进档案是他自己复制过去、在那一格里自己改的。
import { supa } from './backends.js'

const needDb = () => {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
}

/**
 * 「他现在在写哪个」——报给脑子的那份名单。
 *
 * 焦点靠他**本来就在做的事**定：展开着哪几条就是哪几条。没有新按钮，
 * 没有「选中」这个动作要他学。
 *
 * open 的顺序跟栏里一致（不是他点开的先后）——脑子那边列出来时，
 * 跟他在页面上看到的顺序对得上。
 *
 * 展开集合里的 id 可能已经不在这一栏了（库变了、条目被删了）：不许漏进名单，
 * 报一个不存在的 id 上去，它会指着一条谁也找不到的东西说话。
 */
export function focusOf(section, openIds) {
  if (!section?.key) return null
  const items = section.items || []
  return {
    key: section.key,
    label: section.label,
    count: items.length,
    open: items
      .filter((e) => e.id && openIds?.has(e.id))
      .map((e) => ({ id: e.id, title: e.title || '（未命名）' })),
  }
}

/** 拉这一栏的对话。没连库时返回 null（跟 fetchMessages 一个规矩）。 */
export async function fetchStudioThread(section) {
  if (!supa || !section) return null
  const { data, error } = await supa.rpc('pa_studio_thread', { p_section: section })
  if (error) return null
  return data || []
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
