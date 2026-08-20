// state → 你看见的那句话。措辞按设计稿第五节的原文。
//
// 这份是通知栏和人际管理页共用的 —— 同一个 state 在两个地方
// 不许说两种话（措辞分叉的下场见 People.jsx 顶上那段旧注释）。

import { day as dayOf } from './when.js'

const DAY = 86400000
const daysSince = (at) => Math.max(0, Math.round((Date.now() - new Date(at)) / DAY))
const 月日 = (at) => {
  const d = new Date(at)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 主句。 */
export function stateLine(it) {
  const n = daysSince(it.since_at)
  switch (it.state) {
    case 'WAITING_REPLY':
      return it.zone === 'due'
        ? `已经过去 ${n} 天，follow up 已经起草`
        : `已经过去 ${n} 天，设定 follow up 时间为 ${月日(it.due_at)}`
    case 'NEEDS_REPLY':
      return `发来邮件，「${it.what || '（没摘出梗概）'}」需要回复`
    case 'MEETING_SET':
      return it.zone === 'due'
        ? `记得今天见面（${new Date(it.due_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}）`
        : `约了 ${月日(it.due_at)} 见面`
    case 'DEBRIEF':
      return '今天见面怎么样？'
    // OWE_* 的 what 是库里拼好的整句（「见到了你经…」「和…meeting 了」）
    default:
      return it.what || ''
  }
}

/** 副句：判断的理由。判「要回」凭什么 —— 这句原来完全不显示。 */
export function whyLine(it) {
  if (it.state === 'NEEDS_REPLY' && it.why && it.why !== it.what) return `凭什么：${it.why}`
  if (it.state === 'WAITING_REPLY' && it.what) return `在等：${it.what}`
  return null
}
