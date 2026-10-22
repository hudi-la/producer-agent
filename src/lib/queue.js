// 过卡队列 —— 手头这摊活。
//
// 它是**一份待办，不是一趟班次**：没做完的一直在。所以顶栏那个数字说的是
// 一句实话——「你还欠着几件事」。它只降在你按「做完了」的时候：
// 翻页（goto）什么都不改。
//
// 存 localStorage，**不上库**。它是「你这台机器上手头的活」，不是事实。
// 事实（新信、草稿、next_action）全都已经在库里了——队列丢了，一样东西都不会
// 消失，只是要你自己去看板上找。所以这儿只存 id 和「什么送它进来的」，
// 内容永远从库里读。

// 队列**是一条，不是两条**。顶栏那个数字说的是「你还欠着几件事」——
// 它是手头这摊活，不是某个区的活。所以一项要说清自己是什么：
// kind='pursuit' 是机会线，kind='contact' 是人，kind='org' 是机构。
//
// 2026-09-02 起这摞就是**工作区的桌子**（docs/specs/2026-09-02-workspace-design.md）：
// 每一项是桌上开着的一格窗口，at 是你正看着哪格，「移出」就是 ×。
// 「再等一等」退役了——窗口开着不动就是先放着，用不着一个字段来说这句话，
// 所以 skipped / skippedAt 不再存（旧存档里有也扔掉，项本身不丢）。

const KEY = 'pa_queue'
const KINDS = new Set(['pursuit', 'contact', 'org'])
const kindOf = (k) => (KINDS.has(k) ? k : 'pursuit')

/** items: [{kind, id, via}] · at: 你正看着那张的 key */
export const EMPTY = { items: [], at: null }

/**
 * 队列里认身份的键。
 *
 * 以前只有机会线，裸 id 就够用。现在两种东西共用一队，光看 id 分不出
 * 「pursuit 的 x」和「contact 的 x」——虽然 uuid 撞不上，但判据该说对。
 * 不认识的 kind 一律当 pursuit：存坏了也不许冒出第四种东西。
 */
export const key = (kind, id) => `${kindOf(kind)}:${id}`
export const keyOf = (x) => key(x.kind, x.id)

/** 从键拆回来 —— 界面拿它去库里读对应的东西。旧存档里是裸 id，当 pursuit。 */
export const parseKey = (k) => {
  const s = String(k)
  const i = s.indexOf(':')
  if (i < 0) return { kind: 'pursuit', id: s }
  return { kind: kindOf(s.slice(0, i)), id: s.slice(i + 1) }
}

/** 旧存档里 at 是裸 id，读回来补上前缀。 */
const atKey = (a) => (typeof a === 'string' && a ? keyOf(parseKey(a)) : null)

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
      kind: kindOf(x.kind),
      id: x.id,
      // via = 什么送它进来的。'pick' 你自己端上来的 · 'update' 收信收出来的 ·
      // 'say' 群发送来的 · 'bump'/'circleback'/'thanks'/'met' 是人身上的四种由头。
      via: x.via || 'pick',
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

// 下面这些拿 key（'pursuit:xxx' / 'contact:xxx' / 'org:xxx'）认卡，不是裸 id。
// 调用方用 key(kind, id) 拼，或者对手上的项用 keyOf(item)。

/** 光标该不该动：你在别处按的按钮，不该把你正看的那张挪走。
 *  动的话落到原位置上的那格（关掉最后一格就退回前一格）。 */
function keepOrMove(items, q, k, from) {
  if (q.at !== k && items.some((x) => keyOf(x) === q.at)) return q.at
  return keyOf(items[Math.min(from, items.length - 1)])
}

/**
 * 往队里塞。entries 每项是 {kind, id, via}。
 * **已经在队里的不再插一份**，只更新 via。
 * 不然同一条线在队里躺三份，顶栏那个数字立刻就没意义了。
 */
export function enqueue(q, entries) {
  const items = q.items.slice()
  for (const e of entries || []) {
    if (!e || typeof e.id !== 'string') continue
    const k = key(e.kind, e.id)
    const i = items.findIndex((x) => keyOf(x) === k)
    if (i >= 0) items[i] = { ...items[i], via: e.via || items[i].via }
    else items.push({ kind: kindOf(e.kind), id: e.id, via: e.via || 'pick' })
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

export function inQueue(q, k) {
  return q.items.some((x) => keyOf(x) === k)
}

/** 把光标放到那一格上。不在桌上的格子点不着，原样返回。 */
export function select(q, k) {
  return inQueue(q, k) ? { ...q, at: k } : q
}
