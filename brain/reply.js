// 从一次「想」里挑出**给人看的那一段**。
//
// 2026-08-15 查出来的病：think() 原来把每一轮的 text 块无差别攒起来 join('\n')。
// 可 maxTurns 是 20，配着 WebSearch/WebFetch，中间那些轮次产出的不是回答，是**工作稿**——
// "I'll start by loading the web tools."、"Let me fetch it."、还有整段整段的英文中间报告
// （## Verdict / ## Method note / trap / ## CRITICAL DELIVERABLE 这种）。
// 它们全被拼进了落库的那条回复。UCSB 那条线上最狠的一条：365 行里前 282 行是工作稿，
// 第 283 行才开始是给她看的中文。于是
//   · 界面上她看见一大坨不该给她看的英文
//   · 这坨东西还每次都被重新塞进 prompt（那条一条就 31,925 字符）
//
// 判据很简单：**动工具之前说的话都是工作稿**。它要去查资料，说明还没想完；
// 想完了才不用再动工具。所以最后一次动工具之后说的那些，才是回答。
//
// 工作稿不扔——它们回 notes，由调用方存进消息的 meta 里。里面是真查到的东西
// （URL、原文、核实记录），只是不该摆在她眼前，也不该每轮重付一遍。

/**
 * @param blocks 按**发生顺序**排好的 content block（只认 text 和 tool_use，别的忽略）
 * @returns { text, notes, recovered }
 *   text      给人看的回答
 *   notes     动工具之前的那些工作稿，一次工具调用切一段
 *   recovered 最后一轮一个字都没说，只好拿最后一段工作稿顶上（见下）
 */
export function foldReply(blocks) {
  const notes = []
  let cur = []

  for (const b of blocks || []) {
    if (b?.type === 'text') {
      if (b.text) cur.push(b.text)
    } else if (b?.type === 'tool_use') {
      // 攒到这儿的都是「准备动工具」时说的话，切一段收进工作稿
      if (cur.length) notes.push(cur.join('\n'))
      cur = []
    }
  }

  let text = cur.join('\n').trim()

  // 兜底：最后一次动完工具就没再说话（被 maxTurns 截断、或者它自己收尾收丢了）。
  // 这时候宁可把最后一段工作稿端出来，也不能报「空回复」把整轮活儿扔掉——
  // 那才是真丢东西。标一个 recovered 让调用方能说实话。
  let recovered = false
  if (!text && notes.length) {
    text = notes.pop().trim()
    recovered = true
  }

  return { text, notes, recovered }
}
