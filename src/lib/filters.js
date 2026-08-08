// 看板的两个开关。它们说的是「看**哪些**」，不是「怎么排」。
//
// 原来那四个 tab（按阶段/按截止/按作品/按来源）说的都是「怎么排」，
// 而看板已经按阶段排了——排法只能有一种，所以那四个天生互相打架，
// 接哪一个都要把七列拆掉重画。这就是它们两天都接不上的原因。
//
// 这两个不冲突：七列照旧，只是变稀。而且它们可以**同时按下去**——
// 真正有用的恰恰是交叉（球在我这边、而且快到期）。
import { ballOf } from './ball.js'
import { deadlineLine } from './nextAction.js'

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

// 这儿原来还有一对 dueNow / dueReason：「该碰日到了 / 截止逼近」的卡自己进队。
// 撤了。**上面那两个开关已经在做同一件事**——按「待处理 + 紧急」筛一下，
// 该动的就在眼前，勾中「过一遍」端上工作台。多一套后台判据只是把它做两遍，
// 而且做得更差：它只知道它碰巧注意到的那些。
