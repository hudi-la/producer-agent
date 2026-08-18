// 对话里那张填好的表 → 产出里那份一格一格的申请表。
//
// 分工跟 letters.js 的前半段一样：这两件事都是**你的手**，走浏览器直连 anon。
// 脑子没开的时候，你照样收得下、照样在右栏一格一格改得动——这条路上没有
// 任何一步需要模型，所以不该被模型的死活拖住。
//
// （letters.js 有后半段「真发」要走 brain，因为 Gmail 的钥匙在它手上。
//   表单没有那一步：填完你自己去网页表单里粘。）
import { supa } from './backends.js'

const need = () => {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
}

/**
 * 把对话里那张表收成一份 kind='form' 的产出。
 *
 * 同一个所有者 + 同一个表名 = 覆盖那一份，不堆第二份。而且**你已经写了字的
 * 格子一个都不动**——闸在 pa_adopt_form 里，不是在这儿。
 */
export async function adoptForm(owner, form) {
  need()
  const { data, error } = await supa.rpc('pa_adopt_form', {
    p_pursuit_id: owner?.pursuitId || null,
    p_contact_id: owner?.contactId || null,
    p_title: form.title,
    p_fields: form.fields,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * 改其中一格。
 *
 * **一格一支，不整包写回。** 右栏是自动存的（停手 700ms 写一次），整包写的话
 * 你在第三格打字那一刻会连第五格一起写一遍——而第五格可能正是另一次自动存
 * 刚写进去的新值，于是它被一份旧快照盖掉，且没有任何提示。
 */
export async function setAnswer(deliverableId, key, text) {
  need()
  const { error } = await supa.rpc('pa_set_answer', {
    p_id: deliverableId, p_key: key, p_text: text,
  })
  if (error) throw new Error(error.message)
  return { ok: true }
}
