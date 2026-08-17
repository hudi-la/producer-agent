// 「重说」的规则：从你点的那句起，往后的对话不算数了。
//
// 设计稿：docs/specs/2026-08-15-resay-design.md
//
// 库里那份在 0066 的 pa_rewind_chat 里。**这份是它逐条的复刻**，只为一件事：
// 按下「重说」的那一瞬间界面上就得干净，不用等一趟往返。
//
// 两边飘了的后果是最坏的一种：屏幕上撤干净了，Fairwind 却还按那句错话在想，
// 而你查不出为什么 —— 因为你看到的往来里根本没有那句话。所以这里是纯函数，
// rewind.test.js 里那些 case 就是那道迁移的验收清单。

/** 一条消息算不算「你跟 Fairwind 的一来一回」。只有这种会被撤。 */
const isTalk = (m) =>
  (m.role === 'artist' || m.role === 'producer') && (m.kind || 'message') === 'message'

/**
 * 这条能不能点「改这句」。
 *
 * 除了得是你自己说的一句普通话，还得**已经落库** —— 乐观插进去的 tmp- 那条
 * 库里还没有它的 id，撤不了。它几百毫秒后就会被真的那条换掉。
 */
export function canRewind(m) {
  if (!m?.id || String(m.id).startsWith('tmp')) return false
  return m.role === 'artist' && (m.kind || 'message') === 'message'
}

/**
 * 撤掉这条和它之后的所有对话，返回剩下的。
 *
 * 邮件、备注、讲懂、草稿一个不动 —— 那些是真发生过的事和真存在的东西，
 * 你改口不能让它们没发生。所以撤完的时间线上可能留着一封信、一条备注，
 * 而它们中间的对话没了：事实留着，说错的话没了。
 *
 * 按下标切，不按时间比：这个数组本来就是按 created_at 排好的同一条流，
 * 跟库里那句行比较 (created_at, id) >= 锚点 得到的是同一批。
 */
export function dropFrom(msgs, id) {
  const at = msgs.findIndex((m) => m.id === id)
  if (at < 0) return msgs           // 没有这条就别瞎撤
  return msgs.filter((m, i) => i < at || !isTalk(m))
}

/** 这句**后面**还会跟着消失几条（不含这句自己）——说给人听的那个数。 */
export function wipeCount(msgs, id) {
  const at = msgs.findIndex((m) => m.id === id)
  if (at < 0) return 0
  return msgs.slice(at + 1).filter(isTalk).length
}
