import { parseLetters } from '../src/lib/messageLetters.js'
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

  // ── 信本身也必须在信封里（2026-08-18 补的）──────────────────
  //
  // 起因是一次真用：收进产出的是「好的，我帮你回一封……」那一整段车轱辘话，
  // 而不是信。因为原来的信封只带 to/subject/summary，**没带信** ——
  // 于是界面手上唯一能当正文用的就是整条消息。
  //
  // 没有 body 就不算信封，宁可不画那张卡。退回去让他自己复制，是**看得见的
  // 不方便**；画一张卡、点下去收进来一段车轱辘话，是**看不见的错**——
  // 他要到按发送前才发现，甚至发出去了才发现。
  const body = clean1(j?.body)
  if (!body) return { clean, letter: null }

  return {
    clean,
    letter: {
      to,
      // 主题给个兜底：null 传到界面上会画出一行空白，而空白让人以为没写
      subject: clean1(j?.subject) || '（无主题）',
      body,
      summary: clean1(j?.summary),
      reply_to: clean1(j?.reply_to),
      thread_id: clean1(j?.thread_id),
    },
  }
}

export function extractLetters(text) {
  const result = parseLetters(text)
  return { ...result, letter: result.letters.at(-1) || null }
}
