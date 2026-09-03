// 桌上每一格是什么、叫什么。
//
// 队列（lib/queue.js）只存 {kind, id}——内容永远从库里读，这儿把名字对上。
// 名字对不上（数据还没到、卡被删了）不许把格子扔掉：那是「看不见 = 丢了」。
// 交给界面画个占位，× 照样能关。
import { keyOf, parseKey } from './queue.js'

const find = (kind, id, { pursuits = [], contacts = [], orgs = [] }) =>
  kind === 'pursuit' ? pursuits.find((p) => p.id === id)
  : kind === 'contact' ? contacts.find((c) => c.id === id)
  : orgs.find((o) => o.org === id)

const nameOf = (kind, hit) =>
  (!hit ? null : kind === 'pursuit' ? hit.title : kind === 'contact' ? hit.name : hit.org)

/** 桌上那排格子，按放上去的先后。 */
export function deskTabs(q, data = {}) {
  return q.items.map((x) => {
    const { kind, id } = x
    return { k: keyOf(x), kind, id, name: nameOf(kind, find(kind, id, data)) }
  })
}

/** 正看着的那格对应的 view。空桌、或者那张在库里找不到 → home。 */
export function deskView(q, data = {}) {
  if (!q.at) return { name: 'home' }
  const { kind, id } = parseKey(q.at)
  const hit = find(kind, id, data)
  if (!hit) return { name: 'home' }
  return kind === 'pursuit' ? { name: 'pursuit', pursuit: hit }
    : kind === 'contact' ? { name: 'person', person: hit }
    : { name: 'org', org: hit }
}
