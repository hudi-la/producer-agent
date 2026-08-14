// 「你现在在哪」——URL 是唯一的说法。
//
// ══ 为什么需要它 ═══════════════════════════════════════════════
//
// 之前只有「整页打开机会线」那一种情况往 URL 里写过东西（?p=）。别的
// 一律不写，于是：
//   · 刷新一下，不管你在哪，都弹回首页
//   · 新开的标签页落不到那张卡上
//   · 分享链接给自己（"回头看这个人"）根本没链接可分享
//
// 刷新回首页这种事看着像小毛病，其实是「你刚才在做的事没了」——
// 跟队列丢了、卡看不见是同一类：**你手上的位置也是信息。**
//
// ══ 约定 ═══════════════════════════════════════════════════════
//
//   ?a=people|profile   在哪个主区（pursue 是默认，不写）
//   ?p=<id>             打开着一条机会线
//   ?c=<id>             打开着一张名片
//   ?o=<机构名>          打开着一张机构卡
//   &d=1                那条机会线是抽屉不是整页（看板还在旁边）
//
// 卡片参数三选一：同时出现只认第一个（p → c → o），不然「落在哪张卡」
// 就要看谁先被读到，那是种会随实现顺序变的行为。

const AREAS = new Set(['pursue', 'people', 'profile'])

/** 当前状态 → 地址栏该长什么样（含 pathname，可以直接喂 replaceState）。 */
export function toUrl(area, view, pathname = window.location.pathname) {
  const q = new URLSearchParams()
  // pursue 是默认，不写进 URL —— 干净的地址就是「首页」
  if (area && area !== 'pursue') q.set('a', area)
  if (view?.name === 'pursuit' && view.pursuit?.id) {
    q.set('p', view.pursuit.id)
    if (view.mode === 'drawer') q.set('d', '1')
  } else if (view?.name === 'person' && view.person?.id) {
    q.set('c', view.person.id)
  } else if (view?.name === 'org' && view.org?.org) {
    q.set('o', view.org.org)
  }
  const s = q.toString()
  return pathname + (s ? `?${s}` : '')
}

/** 地址栏 → 该恢复成什么。认不出的参数一律忽略，不猜。 */
export function fromUrl(search = window.location.search) {
  const q = new URLSearchParams(search)
  const a = q.get('a')
  const area = AREAS.has(a) ? a : null

  const p = q.get('p')
  const c = q.get('c')
  const o = q.get('o')
  // 三选一，顺序写死。同时出现时不去猜哪个更「对」。
  const card = p ? { kind: 'pursuit', id: p, drawer: q.get('d') === '1' }
    : c ? { kind: 'contact', id: c }
    : o ? { kind: 'org', id: o }
    : null

  return { area, card }
}
