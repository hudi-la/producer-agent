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

/**
 * 有未读回复、这一轮还没自动开过的 —— 该自动摆进「展开的卡片」的就是它们。
 * 线和人一视同仁（人那半的 unread 是 0124 补的）：两边都有一条跟 Fairwind
 * 的对话，它说了话你都一样会漏掉。
 *
 * 小红点说的是「Fairwind 说了话你还没读到」。那正是「今天要弄的」，所以不该
 * 等你去看板上找，它自己就摆到那一排里。读了（markSeen）红点自己灭。
 *
 * already：这一轮已经自动开过的 id。**关掉了就不许再自己回来**——
 * 你按 × 是在说「这张我不要摆着」，它不认这句话就成了赶不走的东西。
 * 刷新之后 already 清空，还没读的会再摆一次：那时它仍然是「你没读到的话」。
 */
export function autoOpen(pursuits = [], already = new Set(), contacts = []) {
  const pick = (rows, kind) => (rows || [])
    .filter((x) => x && x.unread && x.id && !already.has(x.id))
    .map((x) => ({ kind, id: x.id, via: 'update' }))
  return [...pick(pursuits, 'pursuit'), ...pick(contacts, 'contact')]
}
