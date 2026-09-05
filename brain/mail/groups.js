// 一伙人：脑子这边只做一件事——把老信的署名补上。
//
// 「一伙人」那一格（0122）浏览器直接读 pa_group_threads，不靠脑子。但老信的
// To/Cc 没存过署名（0121 才开始存），十几个人只有地址、没有名字，他没法认。
// 所以每轮看一眼哪几串还缺署名，去 Gmail 拿一次信头写回来。补过的 names
// 至少是 {}，下轮就不在 need_names 里了——每串只花一次。
//
// 收人那一步在界面上（他点「把这 N 个都收进通讯录」），走的还是 /mail/adopt
// 那个口，跟「等你点头」认一个人一模一样。

import { db } from './store.js'
import { fetchNames, writeNames } from './copied.js'

const rpc = async (fn, args) => {
  const { data, error } = await db().rpc(fn, args)
  if (error) throw new Error(`${fn} 失败：${error.message}`)
  return data
}

export async function groupNamesPass({ log = console.log } = {}) {
  const groups = (await rpc('pa_group_threads')) || []
  const ids = [...new Set(groups.flatMap((g) => g.need_names || []))]
  if (!ids.length) return { groups: groups.length, filled: 0 }
  const got = await fetchNames(ids)
  const n = await writeNames(ids.map((id) => ({ gmail_message_id: id, names: got.get(id) || {} })))
  log(`  ↳ 一伙人：${groups.length} 串，补了 ${ids.length} 封的署名`)
  return { groups: groups.length, filled: n }
}
