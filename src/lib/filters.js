// 看板的两个开关。它们说的是「看**哪些**」，不是「怎么排」。
//
// 原来那四个 tab（按阶段/按截止/按作品/按来源）说的都是「怎么排」，
// 而看板已经按阶段排了——排法只能有一种，所以那四个天生互相打架，
// 接哪一个都要把七列拆掉重画。这就是它们两天都接不上的原因。
//
// 这两个不冲突：七列照旧，只是变稀。而且它们可以**同时按下去**——
// 真正有用的恰恰是交叉（球在我这边、而且快到期）。
import { ballOf } from './ball.js'
import { deadlineLine, daysFromToday, MD } from './nextAction.js'

/** 界面上摆出来的两个开关，顺序固定。 */
export const FILTERS = [
  ['mine', '待处理'],
  ['urgent', '紧急'],
]

/** 都不按 = 全部。所以没有「全部」那个按钮——它就是"什么都不按"，单列一个反而多余。 */
export const NO_FILTERS = { mine: false, urgent: false }

export function anyOn(on) {
  return Boolean(on?.mine || on?.urgent)
}

/** 这张卡在当前镜头里看得见吗。 */
export function matches(p, on) {
  // 球在谁那边：null = 还没有依据（0017：宁可不说，也不猜）。没有依据就不算待处理。
  if (on?.mine && ballOf(p) !== 'me') return false
  // 紧急 = deadlineLine 自己判的那个 urgent（14 天内 / 已过）。
  // 不在这儿重算门槛——两处算同一件事，早晚会说的不是一句话。
  if (on?.urgent && !deadlineLine(p)?.urgent) return false
  return true
}

export function applyFilters(pursuits, on) {
  if (!anyOn(on)) return pursuits
  return pursuits.filter((p) => matches(p, on))
}

/**
 * 行动时间到了没，以及**哪个日子到了**——过卡队列判据 2。
 * 到日子的卡自己进队，不用你扫看板，也不用等你按「更新最新信息」。
 *
 * 返回一句人话（进队理由）或 null。**必须说得出理由才算到日子**：
 * 卡在队里却说不出为什么，正是这两刀一直在治的病。
 *
 * 两种「到了」：该碰日 ≤ 今天；或截止进了 14 天窗口**而且**球在你这边
 * （对方压着的紧急线该催，但那是判据 1/3 的事——信来了或该碰日到了才吵你，
 *  光是截止近而球在对方，进队只会让你干瞪眼）。
 * 收尾列（谈成/暂停）不算——那两列躺着的日期是历史，不是待办。
 */
export function dueReason(p) {
  if (p.stage === 'won' || p.stage === 'paused') return null
  const touch = daysFromToday(p.next_touch_at)
  if (touch !== null && touch <= 0) {
    const when = MD(p.next_touch_at)
    return touch === 0 ? `该碰一下 · ${when} 定的就是今天`
      : `该碰一下 · ${when} 定的，过了 ${-touch} 天`
  }
  // 「急不急」这个门槛只认 deadlineLine 一处，不另写一套——两处算同一件事，
  // 各写各的迟早对不上（0019 那个病）。
  //
  // 但话要自己组：deadlineLine.text 里带着**截止原文**，而原文可能是一整段
  // （Stanford 那条是「We are now accepting proposals for Spring Quarter 2027.
  // Submissions are due by…」），塞进理由行就成了一堵墙。原文在卡上和事实区
  // 本来就看得见，这行只回答「为什么现在轮到你」。
  if (!deadlineLine(p)?.urgent || ballOf(p) !== 'me') return null
  const n = daysFromToday(p.deadline_at)      // urgent 为真时它必然是个数
  const when = n < 0 ? `截止过了 ${-n} 天` : n === 0 ? '今天截止' : `截止还剩 ${n} 天`
  return `${when} · 球在你`
}

/** 只问要不要进队时用这个。理由要显示就用 dueReason。 */
export function dueNow(p) {
  return dueReason(p) !== null
}
