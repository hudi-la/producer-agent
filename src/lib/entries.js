import { supa } from './backends.js'
import { t } from '../i18n/index.js'
import { EDITABLE } from '../data/schema.js'

// 档案里那 60 条 —— 在页面上改。
//
// 在这之前它们是只读的：v_pa_entries 只 grant 了 select，想改一个作品的描述
// 就得开 SQL。而这些条目是 Fairwind 判断匹配、写「为什么是我」的全部弹药，
// 改不动等于每次都得绕一趟数据库。
//
// 写入口是 0040 那支的 pa_set_entry。它跟 profile 那支有一处**故意不一样**：
//   profile：空字符串 = 不动（名字、网址清空了没有意义）
//   条目：  空字符串 = 清空，null = 不动（描述写错了想删掉是正常需求）
// 所以这一层的责任是把「没动的字段」和「清空成空」分干净 —— 混了的话，
// 改一格会把没碰过的另一格抹掉。

/** 这条能不能改。连不上库时渲染的是种子数据，没有 id，改了也存不进去。 */
export const canEdit = (entry) => Boolean(entry?.id)

/**
 * 把「改了哪一格」翻译成送进库的那一小片。
 *
 * 认不出来就抛，不猜。猜错的后果是存进了一个没人看的地方——
 * 界面上那一格还是旧的，你会以为没存上，再改一次，再存到那个地方去。
 */
export function patchFor(kind, key, value) {
  const fields = EDITABLE[kind]
  if (!fields) throw new Error(t('不认识 {kind} 这类条目，不知道「{key}」该往哪存', { kind, key }))
  const f = fields.find((x) => x.key === key)
  if (!f) throw new Error(t('{kind} 没有「{key}」这个能改的字段', { kind, key }))
  return f.col ? { [key]: value } : { meta: { [key]: value } }
}

/**
 * 存一条。只送传进来的字段，没传的一个都不碰。
 *   saveEntry({ id, title })           只改标题
 *   saveEntry({ id, ...patchFor(...) }) 改一格事实
 */
export async function saveEntry({ id, title = null, body = null, medium = null, year = null, meta = null }) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  if (!id) throw new Error(t('这条没有 id，存不了'))
  const { error } = await supa.rpc('pa_set_entry', {
    p_id: id, p_title: title, p_body: body, p_medium: medium, p_year: year, p_meta: meta,
  })
  if (error) throw new Error(error.message)
}
