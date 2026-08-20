// 到点了该干什么：TIMER 那一列的指令。
//
// **到点那一刻才起草，不提前。** 等 5 天的那封，第 5 天才动笔 ——
// 中间对方回了，那次调用（也是全系统最贵的一种调用：带全卡上下文）
// 就省了。判断出来只是记下「等到哪天」，起草是 due 那天的事。
//
// 这儿只有纯函数（指令文本）；调模型、写卡在 server.js 的 timerPass。
// 跟 judge.js 一个分工。
//
// 设计稿：docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md 第五节

const day = (x) => String(x || '').slice(0, 10)

/**
 * 这一行到点的 state，Fairwind 该在卡里干什么。
 * 返回 null = 到点了但不用 Fairwind 动笔（比如见面当天早上 ——
 * 那只是通知栏的事，界面直接从 v_pa_state 画）。
 */
export function directive(r) {
  switch (r.state) {
    case 'WAITING_REPLY':
      return `到点了。我们在等：**${r.what}**（${day(r.since_at)} 起，约定 ${day(r.due_at)} 没下文就跟进，今天过了 ${r.days_over} 天）。

起草一封 follow-up：简短、贴着上一封的事说，别重复自我介绍。
正文用 [[LETTER]] 信封输出。
如果你读完往来觉得**现在不该催**（比如对方明说了别的时间），
就不用信封，直接一句话说明为什么，并说清该等到什么时候。`

    case 'NEEDS_REPLY':
      return `这封还没回：**${r.what}**${r.why ? `（要回的原因：${r.why}）` : ''}。

手上信息够就直接起草回信，正文用 [[LETTER]] 信封输出。
**缺关键信息就别硬编** —— 把要问 Di Hu 的问题直接问出来（不带信封），
ta 答了你再起草。`

    case 'DEBRIEF':
      return `约在 ${day(r.due_at)} 的见面时间已经过了（${r.what || ''}）。

在卡里问一句，简短：见成了吗？聊了什么、有没有下一步？
不用信封，就是一句问话。`

    case 'OWE_THANKS':
      return `${r.what}

起草那封谢信：短、具体（提被介绍的人叫什么、聊到了哪一步），
不客套堆砌。正文用 [[LETTER]] 信封输出。`

    case 'OWE_MEETING_NOTE':
      return `${r.what}（见面是 ${day(r.since_at)}，48 小时内回一封是礼数）。

起草那封见面后的信：谢时间、接住聊过的具体内容、说清你的下一步。
正文用 [[LETTER]] 信封输出。`

    // MEETING_SET 当天早上：通知栏的事，不用动笔
    default:
      return null
  }
}

/** 去重的钥匙。同一个等待动一次；等待换了（新 since_at）就能再动。 */
export const timerKey = (r) =>
  `${r.state}:${r.subject_id}:${day(r.since_at)}`
