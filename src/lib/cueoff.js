// 你关掉的那些由头。
//
// 存 localStorage，**不上库**——跟过卡队列同一个道理（见 lib/queue.js 开头）：
// 关掉一条由头不是事实，是「我这台机器上先不看它」。事实（那封信、那个日期）
// 一个字都没动，你随时按「都放回来」它们全回来。
//
// 键是 cueKey(contactId, cue) = 谁|哪一种|依据哪天的事实。
// **锚在事实的日期上，不是锚在措辞上**：「3 天没回」明天变「4 天没回」，
// 拿 why 当键的话你今天关掉的明天又冒出来。而他真回你一封新的，
// at 就变了，这条由头理应重新出现——那是新事实，不是你关过的那条。

const KEY = 'pa_cue_off'

/** 读回来。存坏了、被手改过，一律当空 —— 最坏是几条由头重新出现，不丢东西。 */
export function loadOff() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [])
  } catch (_) {
    return new Set()
  }
}

export function saveOff(set) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])) } catch (_) {}
}

/** 关掉一条。返回新的 Set（不改原来那个，好让 React 认得出变了）。 */
export function turnOff(set, key) {
  const next = new Set(set)
  next.add(key)
  saveOff(next)
  return next
}

/** 都放回来。**永远留这条路**——关掉是看不见，看不见不许等于没有。 */
export function turnAllOn() {
  saveOff(new Set())
  return new Set()
}
