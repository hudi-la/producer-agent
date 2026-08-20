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

/**
 * 卡封面那行金色字：「这条线现在卡在什么上」。
 * 一句话 + 到点日 —— 例：「等 Mattie 九月初把 Joo 介绍给你 · 9/1」。
 */
export function goldLine(it) {
  const d = it.due_at ? new Date(it.due_at) : null
  const 日 = d ? `${d.getMonth() + 1}/${d.getDate()}` : null
  switch (it.state) {
    // awaiting 的原文一般自带「等」字（「等 Mattie 九月初介绍 Joo」），
    // 不再加前缀 —— 加了就是「等：等 Mattie…」。
    case 'WAITING_REPLY':     return `${it.what}${日 ? ` · ${日}` : ''}`
    case 'NEEDS_REPLY':       return `欠回信：${it.what}`
    case 'MEETING_SET':       return `约了见面 · ${日}`
    case 'DEBRIEF':           return '见面怎么样？等你说一句'
    case 'OWE_MEETING_NOTE':  return '见完了，欠一封信'
    case 'OWE_THANKS':        return '欠介绍人一声谢'
    default:                  return it.what || ''
  }
}
