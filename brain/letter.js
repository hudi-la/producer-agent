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
// ── 为什么按「标记出现的位置」切，而不是拿正则去匹配那段 JSON ──
// 一开始写的是 /\[\[LETTER\]\]\s*(\{[\s\S]*?\})\s*$/，测试当场按住了它：
// 信封只写了一半（`[[LETTER]] {` 就断了 —— 模型被打断的时候会这样）时，
// 那个正则**整个匹配不上**，于是标记原样留在正文里。而正文是要被复制进
// Gmail 的，那行机器读的字就跟着粘过去了。
//
// 所以切法反过来：先按标记的位置把尾巴剁掉（这一步永远成功），再去试着
// 解析剁下来那一截。解析失败只损失信封，不损失正文。
const TAG = '[[LETTER]]'

const clean1 = (s) => {
  const t = String(s ?? '').trim()
  return t || null
}

export function extractLetter(text) {
  const src = String(text ?? '')
  // 最后一个：正文里万一提到过这个标记（几乎不会，但代价是零），
  // 真正的信封总是最后那个。
  const at = src.lastIndexOf(TAG)
  if (at < 0) return { clean: src.trim(), letter: null }

  const clean = src.slice(0, at).trim()

  let j
  try { j = JSON.parse(src.slice(at + TAG.length).trim()) } catch (_) {
    return { clean, letter: null }
  }

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
