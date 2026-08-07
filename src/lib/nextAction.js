// 卡上「该干什么」那一行。
//
// 以前这行是 next_touch_at 一个字段算出来的，而那个字段被拿来装四种意思，
// 所以说出来的话经常是错的。现在每种意思有自己的字段，这里只负责一件事：
// 挑出**最该现在看见的那一条**，一张卡只显示一行。
//
// 顺序是有理由的：具体的待办 > 快开放 > 该主动碰。
// 截止倒计时不在这儿——它跟着截止那行走（见 deadlineLine），
// 因为「截止 8/7」和「还剩 3 天」是同一件事的两种说法，拆成两行是重复。

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** 'YYYY-MM-DD' → 本地零点的 Date。空值返回 null。 */
const asDate = (s) => (s ? new Date(s + 'T00:00:00') : null)

/** 距今天几天：负数 = 已经过去。 */
export function daysFromToday(dateStr) {
  const d = asDate(dateStr)
  if (!d) return null
  return Math.round((d - startOfToday()) / 86400000)
}

/** 'YYYY-MM-DD' → '8月12日'。导出是给过卡队列说「哪个日子到了」用的。 */
export const MD = (dateStr) => {
  const d = asDate(dateStr)
  return d ? `${d.getMonth() + 1}月${d.getDate()}日` : ''
}

/** 快到期的门槛。再远就不算「急」，免得天天有一堆卡在喊。 */
const SOON_DAYS = 14

/**
 * 截止那一行。原文永远显示（"spring 2027" 这种要保留），
 * 只有能算出日期、而且确实近了，才追加倒计时并标红。
 */
export function deadlineLine(p) {
  if (!p.deadline && !p.deadline_at) return null
  const text = p.deadline || MD(p.deadline_at)
  const n = daysFromToday(p.deadline_at)
  if (n === null || n > SOON_DAYS) return { text: `截止 ${text}`, urgent: false }
  if (n < 0) return { text: `截止 ${text} · 已过`, urgent: true, over: true }
  if (n === 0) return { text: `截止 ${text} · 今天`, urgent: true }
  return { text: `截止 ${text} · 还剩 ${n} 天`, urgent: true }
}

/**
 * 「该干什么」那一行。返回 null = 现在没有该你动的事，卡上就别说话。
 * tick 不为空表示这一行可以勾掉：'action' 走 pa_set_action_done，'touch' 走 pa_mark_touched。
 */
export function actionLine(p) {
  // ① 具体的待办最优先——它是唯一说得出「做什么」的。
  //    作废的跳过（被新信推翻了，划掉的那行在 voidedAction 里），往下顺位——
  //    作废不该让卡哑掉。by 只在这一档有意义：它标的是「这句话谁写的」。
  if (p.next_action && !p.next_action_done_at && !p.next_action_void_at) {
    return {
      text: p.next_action, tick: 'action', urgent: true,
      by: p.next_action_by === 'fairwind' ? 'fairwind' : null,
    }
  }
  // ② 还没开放：说清楚是在等它开门，不是等你动手
  const opens = daysFromToday(p.opens_at)
  if (opens !== null && opens > 0) {
    return { text: `${MD(p.opens_at)}起开放 · 还有 ${opens} 天`, tick: null, urgent: false, by: null }
  }
  // ③ 到了你自己定的「该碰一下」的日子（无截止的冷外联专用）
  const touch = daysFromToday(p.next_touch_at)
  if (touch !== null && touch <= 0) {
    return { text: '该碰一下了', tick: 'touch', urgent: true, by: null }
  }
  return null
}

/** 被新信作废的待办。划掉留痕：原文、何时、因为哪封信（点得回去）。 */
export function voidedAction(p) {
  if (!p.next_action || !p.next_action_void_at) return null
  const d = new Date(p.next_action_void_at)
  return { text: p.next_action, at: `${d.getMonth() + 1}月${d.getDate()}日`, byMsg: p.next_action_void_by || null }
}

/** 已经勾掉的待办，详情页用来显示「✓ …… · 8月4日完成」。 */
export function doneAction(p) {
  if (!p.next_action || !p.next_action_done_at) return null
  const d = new Date(p.next_action_done_at)
  return { text: p.next_action, at: `${d.getMonth() + 1}月${d.getDate()}日` }
}
