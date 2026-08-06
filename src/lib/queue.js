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

const KEY = 'pa_queue'

/** items: [{id, via, skipped, skippedAt}] · at: 你正看着那张的 pursuit_id */
export const EMPTY = { items: [], at: null }

/** 今天，'YYYY-MM-DD'。传得进来是为了测试能写死日期。 */
const todayStr = () => {
  const d = new Date()
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 存进去的东西可能是上个版本写的、可能被手改坏了。读回来一律过一遍这里。
 * 挡三样：非法项、重复的 id（重复了那个数字立刻没意义）、指不到人的光标。
 */
export function normalize(raw) {
  if (!raw || !Array.isArray(raw.items)) return EMPTY
  const seen = new Set()
  const items = []
  for (const x of raw.items) {
    if (!x || typeof x.id !== 'string' || seen.has(x.id)) continue
    seen.add(x.id)
    items.push({
      id: x.id,
      // via = 什么送它进来的。第一刀只有 'pick'（你自己端上来的）；
      // 第二刀会有收信 / 待办作废 / 新的下一步。字段先留着，免得那时候还要迁存储。
      via: x.via || 'pick',
      skipped: Boolean(x.skipped),
      skippedAt: x.skippedAt || null,
    })
  }
  if (!items.length) return EMPTY
  const at = items.some((x) => x.id === raw.at) ? raw.at : items[0].id
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

/** 从 from 开始找第一张没被放过的；找不到就往前找；再找不到就随便给一张（全放过了）。 */
function liveAt(items, from) {
  for (let i = from; i < items.length; i++) if (!items[i].skipped) return items[i].id
  for (let i = Math.min(from, items.length) - 1; i >= 0; i--) if (!items[i].skipped) return items[i].id
  return items[Math.min(from, items.length - 1)]?.id ?? null
}

/** 光标该不该动：你在别处按的按钮，不该把你正看的那张挪走。 */
function keepOrMove(items, q, id, from) {
  if (q.at !== id && items.some((x) => x.id === q.at)) return q.at
  return liveAt(items, from)
}

/**
 * 往队里塞。
 * **已经在队里的不再插一份**，只更新 via 并清掉「先放着」——它变了，值得你再看一眼。
 * 不然同一条线在队里躺三份，顶栏那个数字立刻就没意义了。
 */
export function enqueue(q, entries) {
  const items = q.items.slice()
  for (const e of entries || []) {
    if (!e || typeof e.id !== 'string') continue
    const i = items.findIndex((x) => x.id === e.id)
    if (i >= 0) items[i] = { ...items[i], via: e.via || items[i].via, skipped: false, skippedAt: null }
    else items.push({ id: e.id, via: e.via || 'pick', skipped: false, skippedAt: null })
  }
  if (!items.length) return EMPTY
  const at = items.some((x) => x.id === q.at) ? q.at : items[0].id
  return { items, at }
}

/** 做完了：拿走。这是唯一让顶栏数字降下去的路。 */
export function done(q, id) {
  const i = q.items.findIndex((x) => x.id === id)
  if (i < 0) return q
  const items = q.items.filter((x) => x.id !== id)
  if (!items.length) return EMPTY
  return { items, at: keepOrMove(items, q, id, i) }
}

/**
 * 再等一等：**留着**，挪队尾，打上「你先放着了」。
 * 数字不降——它还欠着。挪队尾只是为了这一轮不再挡你。
 */
export function later(q, id, on = todayStr()) {
  const i = q.items.findIndex((x) => x.id === id)
  if (i < 0) return q
  const moved = { ...q.items[i], skipped: true, skippedAt: on }
  const items = [...q.items.slice(0, i), ...q.items.slice(i + 1), moved]
  return { items, at: keepOrMove(items, q, id, i) }
}

/** 你正看着的是第几张（0 起）。不在队里返回 -1。 */
export function indexOf(q) {
  return q.items.findIndex((x) => x.id === q.at)
}

/** ‹ › 翻页。**什么都不改**，只移动光标——翻回来那张原样在那儿。到头就停住，不回绕。 */
export function goto(q, delta) {
  if (!q.items.length) return q
  const i = indexOf(q)
  const n = Math.max(0, Math.min(q.items.length - 1, (i < 0 ? 0 : i) + delta))
  return { ...q, at: q.items[n].id }
}

/** 剩下的是不是你这一轮全放过了。空队返回 false —— 没有"剩下的"。 */
export function allSkipped(q) {
  return q.items.length > 0 && q.items.every((x) => x.skipped)
}

export function inQueue(q, id) {
  return q.items.some((x) => x.id === id)
}
