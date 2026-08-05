// 球在谁那边。自动判断在库里算（v_pa_pursuits.ball_auto），这里只负责
// 「手动优先于自动」这一条规则和文案，让卡片和详情页说的是同一句话。
export const BALL_LABEL = { me: '待处理', them: '等回复' }

/** 实际生效的球权：手动设了就听手动，没设就听自动。都没有则返回 null（没球可打）。 */
export function ballOf(p) {
  return p.ball || p.ball_auto || null
}

/** 这条线的球权是手动钉住的吗（用来在详情页显示「自动 / 手动」）。 */
export function isManual(p) {
  return !!p.ball
}
