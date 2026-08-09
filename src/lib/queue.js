// 过卡队列 —— 手头这摊活。
//
// 它是**一份待办，不是一趟班次**：没做完的一直在。所以顶栏那个数字说的是
// 一句实话——「你还欠着几件事」。它只降在你按「做完了」的时候：
// 翻页（goto）什么都不改，「再等一等」（later）也不把卡拿走。
//
// 存 localStorage，**不上库**。它是「你这台机器上手头的活」，不是事实。
// 事实（新信、草稿、next_action）全都已经在库里了——队列丢了，一样东西都不会
// 消失，只是要你自己去看板上找。所以这儿只存 id 和「什么送它进来的」，
// 内容永远从库里读。

// 队列**是一条，不是两条**。顶栏那个数字说的是「你还欠着几件事」——
// 它是手头这摊活，不是某个区的活。所以一项要说清自己是什么：
// kind='pursuit' 是机会线，kind='contact' 是人。两种东西混在同一队里过。

const KEY = 'pa_queue'

/** items: [{kind, id, via, skipped, skippedAt}] · at: 你正看着那张的 key */
export const EMPTY = { items: [], at: null }

/**
 * 队列里认身份的键。
 *
 * 以前只有机会线，裸 id 就够用。现在两种东西共用一队，光看 id 分不出
 * 「pursuit 的 x」和「contact 的 x」——虽然 uuid 撞不上，但判据该说对。
 * 不认识的 kind 一律当 pursuit：存坏了也不许冒出第三种东西。
 */
export const key = (kind, id) => `${kind === 'contact' ? 'contact' : 'pursuit'}:${id}`
export const keyOf = (x) => key(x.kind, x.id)

/** 从键拆回来 —— 界面拿它去库里读对应的东西。旧存档里是裸 id，当 pursuit。 */
export const parseKey = (k) => {
  const s = String(k)
  const i = s.indexOf(':')
  if (i < 0) return { kind: 'pursuit', id: s }
  const kind = s.slice(0, i)
  return { kind: kind === 'contact' ? 'contact' : 'pursuit', id: s.slice(i + 1) }
}

/** 旧存档里 at 是裸 id，读回来补上前缀。 */
const atKey = (a) => (typeof a === 'string' && a ? keyOf(parseKey(a)) : null)

/** 今天，'YYYY-MM-DD'。传得进来是为了测试能写死日期。 */
const todayStr = () => {
  const d = new Date()
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 存进去的东西可能是上个版本写的、可能被手改坏了。读回来一律过一遍这里。
 * 挡三样：非法项、重复的（去重按 kind+id）、指不到人的光标。
 *
 * **旧存档里的项没有 kind**（那时候队里只有机会线），一律当 pursuit ——
 * 这正是这个函数存在的理由，localStorage 里现有的队列一项都不会丢。
 */
export function normalize(raw) {
  if (!raw || !Array.isArray(raw.items)) return EMPTY
  const seen = new Set()
  const items = []
  for (const x of raw.items) {
    if (!x || typeof x.id !== 'string') continue
    const k = key(x.kind, x.id)
    if (seen.has(k)) continue
    seen.add(k)
    items.push({
      kind: x.kind === 'contact' ? 'contact' : 'pursuit',
      id: x.id,
      // via = 什么送它进来的。'pick' 你自己端上来的 · 'update' 收信收出来的 ·
      // 'bump'/'circleback'/'thanks'/'met' 是人身上的四种由头。
      via: x.via || 'pick',
      skipped: Boolean(x.skipped),
      skippedAt: x.skippedAt || null,
    })
  }
  if (!items.length) return EMPTY
  const want = atKey(raw.at)
  const at = items.some((x) => keyOf(x) === want) ? want : keyOf(items[0])
  return { items, at }
}

export function loadQueue() {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY) || 'null'))
  } catch (_) {
    return EMPTY
  }
}

export function saveQueue(q) {
  try { localStorage.setItem(KEY, JSON.stringify(q)) } catch (_) {}
}

// 下面这些拿 key（'pursuit:xxx' / 'contact:xxx'）认卡，不是裸 id。
// 调用方用 key(kind, id) 拼，或者对手上的项用 keyOf(item)。

/** 从 from 开始找第一张没被放过的；找不到就往前找；再找不到就随便给一张（全放过了）。 */
function liveAt(items, from) {
  for (let i = from; i < items.length; i++) if (!items[i].skipped) return keyOf(items[i])
  for (let i = Math.min(from, items.length) - 1; i >= 0; i--) if (!items[i].skipped) return keyOf(items[i])
  const last = items[Math.min(from, items.length - 1)]
  return last ? keyOf(last) : null
}

/** 光标该不该动：你在别处按的按钮，不该把你正看的那张挪走。 */
function keepOrMove(items, q, k, from) {
  if (q.at !== k && items.some((x) => keyOf(x) === q.at)) return q.at
  return liveAt(items, from)
}

/**
 * 往队里塞。entries 每项是 {kind, id, via}。
 * **已经在队里的不再插一份**，只更新 via 并清掉「先放着」——它变了，值得你再看一眼。
 * 不然同一条线在队里躺三份，顶栏那个数字立刻就没意义了。
 */
export function enqueue(q, entries) {
  const items = q.items.slice()
  for (const e of entries || []) {
    if (!e || typeof e.id !== 'string') continue
    const k = key(e.kind, e.id)
    const i = items.findIndex((x) => keyOf(x) === k)
    if (i >= 0) items[i] = { ...items[i], via: e.via || items[i].via, skipped: false, skippedAt: null }
    else items.push({
      kind: e.kind === 'contact' ? 'contact' : 'pursuit',
      id: e.id, via: e.via || 'pick', skipped: false, skippedAt: null,
    })
  }
  if (!items.length) return EMPTY
  const at = items.some((x) => keyOf(x) === q.at) ? q.at : keyOf(items[0])
  return { items, at }
}

/** 做完了：拿走。这是唯一让顶栏数字降下去的路。 */
export function done(q, k) {
  const i = q.items.findIndex((x) => keyOf(x) === k)
  if (i < 0) return q
  const items = q.items.filter((x) => keyOf(x) !== k)
  if (!items.length) return EMPTY
  return { items, at: keepOrMove(items, q, k, i) }
}

/**
 * 再等一等：**留着**，挪队尾，打上「你先放着了」。
 * 数字不降——它还欠着。挪队尾只是为了这一轮不再挡你。
 */
export function later(q, k, on = todayStr()) {
  const i = q.items.findIndex((x) => keyOf(x) === k)
  if (i < 0) return q
  const moved = { ...q.items[i], skipped: true, skippedAt: on }
  const items = [...q.items.slice(0, i), ...q.items.slice(i + 1), moved]
  return { items, at: keepOrMove(items, q, k, i) }
}

/** 你正看着的是第几张（0 起）。不在队里返回 -1。 */
export function indexOf(q) {
  return q.items.findIndex((x) => keyOf(x) === q.at)
}

/** ‹ › 翻页。**什么都不改**，只移动光标——翻回来那张原样在那儿。到头就停住，不回绕。 */
export function goto(q, delta) {
  if (!q.items.length) return q
  const i = indexOf(q)
  const n = Math.max(0, Math.min(q.items.length - 1, (i < 0 ? 0 : i) + delta))
  return { ...q, at: keyOf(q.items[n]) }
}

/** 剩下的是不是你这一轮全放过了。空队返回 false —— 没有"剩下的"。 */
export function allSkipped(q) {
  return q.items.length > 0 && q.items.every((x) => x.skipped)
}

export function inQueue(q, k) {
  return q.items.some((x) => keyOf(x) === k)
}
