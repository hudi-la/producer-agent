// state → 你看见的那句话。措辞按设计稿第五节的原文。
//
// 这份是通知栏和人际管理页共用的 —— 同一个 state 在两个地方
// 不许说两种话（措辞分叉的下场见 People.jsx 顶上那段旧注释）。

import { day as dayOf } from './when.js'
import { t } from '../i18n/index.js'

const DAY = 86400000
/**
 * 三次规矩：连着三封没回就停（原信 + 两次 follow up）。跟 8/8 人际层设计稿
 * 和 cues.js 的 BUMP_WAIT 同一条规矩；库里 v_pa_state 的 zone='stopped' 也按它算。
 */
export const MAX_FOLLOWUPS = 2
const daysSince = (at) => Math.max(0, Math.round((Date.now() - new Date(at)) / DAY))
const 月日 = (at) => {
  const d = new Date(at)
  return t('{m} 月 {d} 日', { m: d.getMonth() + 1, d: d.getDate() })
}

/** 主句。 */
export function stateLine(it) {
  const n = daysSince(it.since_at)
  switch (it.state) {
    case 'WAITING_REPLY':
      // 人家回信了就不叫「没等到」（0116，2026-09-02 他拍的）。
      // 他的原话：「这个提醒是该在那儿的，我想说的是它写的内容应该是**你收到了
      // 对方的来信，请你回复**，而不是你等了好几天还没等到，需要催一下。」
      //
      // replied_at 只在**那封信还没判过**的时候有值（见 0116）。判完了这行
      // 自己就走了：关掉等待、或者「该你回」上台、或者判成答非所问 ——
      // 那时候「该催了」是对的，这句就不再出现。
      // 催一个已经回过你的人，按下 follow up 的是他自己的手，错不起。
      if (it.replied_at) return t('对方 {d}来信了 —— 该你回', { d: 月日(it.replied_at) })
      // 到点的等待 = 「等够了，该催了」。原来写「在等 X」又摆在「该动的」，
      // 他一眼看出自相矛盾（「等回信应该在等待里面呀」）——位置和话要说同一件事。
      // 第几次 follow up 要说出来（0117，2026-09-02 他要的）：催过一两回之后
      // 这句要是跟第一次一模一样，就看不出这条线已经追到第几回了。
      // m = 这个等待开了之后你发出去的信数，库里数的（followups），不是判断。
      //
      // 三次规矩（0118，2026-09-02 他拍的）：连发三封没回就别再催了 ——
      // 第四封只是第四次提交同一个被压下去的请求。条目不消失（消失 = 你以为
      // 系统还在管），改说换法子；法子本身是判断，Fairwind 到点在卡里给。
      const m = it.followups || 0
      if (it.zone === 'stopped')
        return t('连发 {n} 封没等到回复 —— 别再催了，换个法子（Fairwind 在卡里给建议）', { n: m + 1 })
      if (it.zone === 'due') {
        return m
          ? t('第 {m} 次 follow up 等了 {n} 天没等到 —— 该催了，第 {k} 次 follow up 在卡里', { m, n, k: m + 1 })
          : t('等了 {n} 天没等到 —— 该催了，第 1 次 follow up 在卡里', { n })
      }
      return m >= MAX_FOLLOWUPS
        ? t('已经过去 {n} 天，这是连发的第 {k} 封 —— {d}前没回就不再催', { n, k: m + 1, d: 月日(it.due_at) })
        : t('已经过去 {n} 天，设定 follow up 时间为 {d}', { n, d: 月日(it.due_at) })
    case 'NEEDS_REPLY':
      return t('发来邮件，「{what}」需要回复', { what: it.what || t('（没摘出梗概）') })
    case 'MEETING_SET':
      return it.zone === 'due'
        ? t('记得今天见面（{time}）', { time: new Date(it.due_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) })
        : t('约了 {d} 见面', { d: 月日(it.due_at) })
    case 'DEBRIEF':
      return t('今天见面怎么样？')
    // OWE_* 的 what 是库里拼好的整句（「见到了你经…」「和…meeting 了」）
    default:
      return it.what || ''
  }
}

/** 副句：判断的理由。判「要回」凭什么 —— 这句原来完全不显示。 */
export function whyLine(it) {
  if (it.state === 'NEEDS_REPLY' && it.why && it.why !== it.what) return t('凭什么：{why}', { why: it.why })
  if (it.state === 'WAITING_REPLY' && it.what) {
    // 信来了也得说清你原来等的是什么 —— 那是你为什么该管这封信。
    if (it.replied_at) return t('你等的是：{what}', { what: it.what })
    return it.zone === 'waiting' ? t('在等：{what}', { what: it.what }) : t('没等到的是：{what}', { what: it.what })
  }
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
    case 'WAITING_REPLY':     return it.replied_at ? t('对方来信了 —— 该你回')
                                   : it.zone === 'stopped' ? t('连发 {n} 封没回 —— 停了，换法子', { n: (it.followups || 0) + 1 })
                                   : `${it.what}${日 ? ` · ${日}` : ''}`
    case 'NEEDS_REPLY':       return t('欠回信：{what}', { what: it.what })
    case 'MEETING_SET':       return t('约了见面 · {d}', { d: 日 })
    case 'DEBRIEF':           return t('见面怎么样？等你说一句')
    case 'OWE_MEETING_NOTE':  return t('见完了，欠一封信')
    case 'OWE_THANKS':        return t('欠介绍人一声谢')
    default:                  return it.what || ''
  }
}
