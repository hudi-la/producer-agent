import { takeTag, clean1 } from './tag.js'

// 「这段回复是一封信」的信封。
//
// 跟 extractFacts 是同一个路子：机器读的那行贴在回复末尾，摘出来之后
// 从展示文本里去掉。**不叫 [[MAIL]]** —— 那个名字被同步那条路占着
// （server.js 里让模型汇报「这次收到哪些新信」用的就是它），撞名的话
// 两处解析会互相咬。
//
// ── 这儿判断的是什么 ────────────────────────────────────────
// 只判断「形式上这是一封信」：有收件人、有主题、有称呼和落款。这件事它
// 写的时候本来就知道，不用猜。
//
// **不判断「这封该不该发」。** 那是他点「收进产出」那一下。刀切在这儿，
// 「AI 判断得准不准」这个风险就基本消失了：它最多把一段本来只是示范语气
// 的话也标成信，代价是产出栏多一份随手删掉的草稿 —— 不是发错信。
//
// ── 一条硬规矩 ──────────────────────────────────────────────
// **信封坏了绝不能连累正文。** 回复本身是它想了半天的东西，为了一行
// 机器读的字把它整个丢掉，是这儿能犯的最蠢的错。所以下面每一条不合格
// 的路径都只把 letter 置空，clean 照样交出去。
//
// 怎么摘、为什么这么摘，都在 tag.js 里 —— [[FORM]] 那条路用的是同一份。
// 抄第二份的话，「标记只写了一半」那个坑要各踩一次。

export function extractLetter(text) {
  const { clean, data: j } = takeTag(text, 'LETTER')
  if (!j) return { clean, letter: null }

  // 没有收件人就不是一封能发的信。留着它只会让界面画出一张点了没反应的卡 ——
  // 而「点了没反应」是最难查的一种坏法，看起来像功能没做。
  const to = clean1(j?.to)?.toLowerCase()
  if (!to || !to.includes('@')) return { clean, letter: null }

  return {
    clean,
    letter: {
      to,
      // 主题给个兜底：null 传到界面上会画出一行空白，而空白让人以为没写
      subject: clean1(j?.subject) || '（无主题）',
      summary: clean1(j?.summary),
      reply_to: clean1(j?.reply_to),
      thread_id: clean1(j?.thread_id),
    },
  }
}
