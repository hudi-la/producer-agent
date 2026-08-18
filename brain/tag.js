// 回复末尾那行机器读的字，怎么摘。
//
// 已经有两处要用（[[LETTER]] 一封信、[[FORM]] 一张表），以后还会有第三处。
// 抄第二份的下场这个仓库见过：Md 只活在 PursuitFocus 里，于是名片上的粗体
// 渲成了四个星号。解析器比渲染更不该分叉——分叉之后一边修好了另一边照旧坏，
// 而坏的表现是「那张卡不出现」，看起来像功能没做。
//
// ── 切法：先剁位置，后解析 ────────────────────────────────────
// 一开始写的是 /\[\[LETTER\]\]\s*(\{[\s\S]*?\})\s*$/，测试当场按住了它：
// 标记只写了一半（`[[LETTER]] {` 就断了 —— 模型被打断的时候会这样）时，
// 那个正则**整个匹配不上**，于是标记原样留在正文里。而正文是要被复制进
// Gmail 的，那行机器读的字就跟着粘过去了。
//
// 所以反过来：先按标记出现的位置把尾巴剁掉（这一步永远成功），再去试着
// 解析剁下来那一截。**解析失败只损失标记，不损失正文。**
// 正文是它想了半天的东西，为了一行机器读的字把它整个丢掉是最蠢的错。

/**
 * 摘走末尾那个 [[NAME]] {...}。
 *
 * 返回 { clean, data }：clean 永远是去掉标记之后的正文，data 解析不出来就是 null。
 */
export function takeTag(text, name) {
  const src = String(text ?? '')
  const tag = `[[${name}]]`
  // 最后一个：正文里万一提到过这个标记（几乎不会，但代价是零），
  // 真正的那个总是最后那一个。
  const at = src.lastIndexOf(tag)
  if (at < 0) return { clean: src.trim(), data: null }

  const clean = src.slice(0, at).trim()
  try {
    return { clean, data: JSON.parse(src.slice(at + tag.length).trim()) }
  } catch (_) {
    return { clean, data: null }
  }
}

/** 空白串一律当没有。null 比 '' 好使：界面上 '' 会画出一行看不见的空白。 */
export const clean1 = (s) => {
  const t = String(s ?? '').trim()
  return t || null
}
