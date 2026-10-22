// 「这段回复在改提醒」的信封：[[STATE]]。
//
// ══ 这是什么 ══════════════════════════════════════════════════
//
// 提醒栏（通知栏 + 卡面金字）是 v_pa_state 按规则算出来的；聊天里 Fairwind
// 带着全卷宗，判得常常比盲格子准。他定的（2026-09-04）：**聊天为准，默认落地，
// 按了能撤回。** Fairwind 在回复末尾报这个信封，server.js 当场调
// pa_apply_state_move 记一条 decision 笔 + 标签，提醒栏跟着变；气泡底下一张
// 小卡带【撤回】。
//
// ══ 这儿判断的是什么 ═════════════════════════════════════════
//
// 只判「形式上这是一个能执行的拨法」：move 在七种之内、why 在、该带的日子在、
// 日子在今天之后。跟 letter.js 一个脾气：**信封坏了不连累正文**，不合格的路径
// 只把 move 置空，clean 照样交出去。
//
// 七种拨法是**封闭的集合**：说不出集合之外的改法，系统也执行不了 ——
// 这就是「聊天为准」不会失控的地方。落库只走 pa_apply_state_move 一个口。
//
// 设计稿：docs/specs/2026-09-04-chat-moves-the-state-design.md 第三节

import { takeTag, clean1 } from './tag.js'
import { envNow } from './tenant.js'

export const MOVES = ['resolved', 'wait', 'reschedule', 'park', 'needs_reply', 'meeting', 'met', 'done']

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISO_MIN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/** 当地的今天，YYYY-MM-DD。tz 缺了按 LA（跟 v_pa_state 里那个兜底一样）。 */
export function localToday(tz, now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: tz || 'America/Los_Angeles' })
}

const day = (s) => (typeof s === 'string' && ISO_DAY.test(s.trim()) ? s.trim() : null)

/**
 * 摘走 [[STATE]] {...}。返回 { clean, move }，move 不合格就是 null。
 *
 * 成对规矩（照 parseTag）：
 *   wait 没 awaiting 或没 due → 丢；reschedule / park 没 due → 丢
 *   due 不在今天之后 → 丢（「到今天」的等待等于没设；今天不知道就一律丢）
 *   needs_reply 没 reply_why → 丢
 *   resolved 带的 needs_reply 没 reply_why → 只丢 needs_reply，resolved 留着
 *   meeting 没 meet_at → 丢；纯日期给个中午（跟 parseTag 一样，免得时区一晃变昨天）
 *   why 是空的 → 丢（那句要显示给他看，没有就是「不知道为什么改了」）
 */
export function extractStateMove(text, { today } = {}) {
  const { clean, data } = takeTag(text, 'STATE')
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { clean, move: null }

  const move = clean1(data.move)
  const why = clean1(data.why)
  if (!MOVES.includes(move) || !why) return { clean, move: null }

  const due = day(data.due)
  const futureDue = Boolean(due && today && due > today)
  const out = { move, why }

  switch (move) {
    case 'wait': {
      const awaiting = clean1(data.awaiting)
      if (!awaiting || !futureDue) return { clean, move: null }
      out.awaiting = awaiting; out.due = due
      break
    }
    case 'reschedule':
    case 'park':
      if (!futureDue) return { clean, move: null }
      out.due = due
      break
    case 'needs_reply': {
      const rw = clean1(data.reply_why)
      if (!rw) return { clean, move: null }
      out.needs_reply = true; out.reply_why = rw
      break
    }
    case 'resolved': {
      const rw = clean1(data.reply_why)
      if (data.needs_reply === true && rw) { out.needs_reply = true; out.reply_why = rw }
      break
    }
    case 'meeting': {
      const s = typeof data.meet_at === 'string' ? data.meet_at.trim() : ''
      if (ISO_DAY.test(s)) out.meet_at = `${s}T12:00`
      else if (ISO_MIN.test(s)) out.meet_at = s
      else return { clean, move: null }
      break
    }
    case 'met':      // 见成了：一条 meet 笔，48 小时信从它长出来
    case 'done':
      break
  }
  return { clean, move: out }
}

/**
 * 「这句值得记住」的信封：[[MEMO]]。记忆不是事件 —— 不动状态机。
 * to='person' 只在跟一个人聊时合法（server 那头按 owner 把关，这儿只认形状）。
 */
export function extractMemo(text) {
  const { clean, data } = takeTag(text, 'MEMO')
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { clean, memo: null }
  const to = clean1(data.to)
  const t = clean1(data.text)
  if (!['line', 'person'].includes(to) || !t) return { clean, memo: null }
  return { clean, memo: { to, text: t } }
}

/**
 * 两个信封可以同出（各占一行，都在末尾），顺序不定。takeTag 只认最后那个，
 * 所以轮着剥：STATE 剥不下来就先剥 MEMO，再回头剥 STATE。最多三轮。
 */
export function peelEnvelopes(text, { today } = {}) {
  let clean = text, move = null, memo = null
  for (let i = 0; i < 3 && !(move && memo); i++) {
    const before = clean
    if (!move) { const r = extractStateMove(clean, { today }); clean = r.clean; move = r.move }
    if (!memo) { const r = extractMemo(clean); clean = r.clean; memo = r.memo }
    if (clean === before) break
  }
  return { clean, move, memo }
}

/** 小卡那行字（记忆）。 */
export const memoLine = (memo) => (memo.text.length > 80 ? memo.text.slice(0, 79) + '…' : memo.text)

const 月日 = (iso) => {
  const [, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return `${m}/${d}`
}

/** 小卡第一行，也是那条笔的正文、标签的 gist —— 三处一个字不差。 */
export function moveLine(mv) {
  // 英文版(2026-10-08):这一行会落进库、显示在时间线和卡上,按这个人的语言写。
  // 读 envNow 不读 prompt.js 的 outputLang——prompt.js 反过来 import 这个文件,会转圈
  if (envNow().FAIRWIND_LANG === 'en') {
    switch (mv.move) {
      case 'wait':        return `${mv.awaiting} · until ${月日(mv.due)}`
      case 'reschedule':  return `Follow-up moved to ${月日(mv.due)}`
      case 'park':        return `Parked until ${月日(mv.due)}`
      case 'resolved':    return mv.needs_reply ? 'No need to wait anymore, but this one needs a reply' : 'No need to wait anymore'
      case 'needs_reply': return 'This one needs a reply'
      case 'meeting':     return `Meeting on ${月日(mv.meet_at)}`
      case 'met':         return 'The meeting happened'
      case 'done':        return 'Nothing more to do here'
      default:            return ''
    }
  }
  switch (mv.move) {
    case 'wait':        return `${mv.awaiting} · 到 ${月日(mv.due)}`
    case 'reschedule':  return `到点日改到 ${月日(mv.due)}`
    case 'park':        return `先放到 ${月日(mv.due)}`
    case 'resolved':    return mv.needs_reply ? '不用再等了，但这封要回' : '不用再等了'
    case 'needs_reply': return '这封要回'
    case 'meeting':     return `约了 ${月日(mv.meet_at)} 见面`
    case 'met':         return '见成了'
    case 'done':        return '这件事不用管了'
    default:            return ''
  }
}

// ── prompt 的两段 ─────────────────────────────────────────────

/** 静态块那段规矩（永不变，跟 LETTER_RULE 并排，跨会话缓存）。 */
export const STATE_RULE = `## 拨提醒

提醒栏（通知栏和卡面那行金字）是按规则算出来的「这条线在等什么、到点没」。
你手上有全卷宗，**你的判断为准**：读完往来觉得提醒该改，就在整段回复的
**最后一行**单独加这一行（跟写信那行一样，别的什么都不要加；一次回复只认一个）：

[[STATE]] {"move":"…","why":"凭什么，一句话（会显示给他看）", …按 move 带字段}

move 只有八种，别的不认：
- "resolved"：对方那封其实已经算回了 / 等的事已经解决。那封信还要他回的话，带 "needs_reply":true,"reply_why":"凭什么"。
- "wait"：改等别的事，或换了法子之后等结果（「打电话，等一周看接不接」）。带 "awaiting":"在等对方做什么","due":"YYYY-MM-DD"。
- "reschedule"：等的事没变，只改到点日（「周四再催」）。带 "due"。
- "park"：先放着，到某天再看。带 "due"。
- "needs_reply"：这封其实要他回。带 "reply_why"。
- "meeting"：约了日子。带 "meet_at":"YYYY-MM-DDTHH:mm"（当地时间）。
- "met"：**他说见面 / 通话已经发生了**（「今天见了」「聊了一下，对方感兴趣」）。他那句原话会记成一条见面笔，见面后的 48 小时信从它长出来。见完之后又起了新的等（「他要和上司商量再回我」），再另报一个 wait 也行 —— 但一次回复只认一个 STATE，那就先报 met，wait 下一句再说；拿不准就报 met。
- "done"：这件事不用管了。

它会**当场生效**：提醒栏立刻换成你说的，他随时能撤回。所以只在你真的得出了
「提醒该改」的结论时才加；只是讨论、给建议、拿不准，都不加。due 必须在今天之后。`

/** 静态块那段：他说的每句先分三类。跟 STATE_RULE 并排。 */
export const MEMO_RULE = `## 他说的每一句，先分清是哪一种

- **事件**（动状态的事实：打了没接、表单交了、见完了、周四再催、不用等了）→ 按上面「拨提醒」报 [[STATE]]。他那句原话会原样记进时间线，你不用复述。
- **记忆**（以后要记得、但不动状态的认识：他是我 CalArts 的老师、她不爱接电话、这个资助只报销机票）→ 报 [[MEMO]]。
- **商量**（问你怎么写、让你查、讨论、闲聊）→ 什么都不报。这是常态。

[[MEMO]] {"to":"line"|"person","text":"要记的那句 —— 用他的原话，可以截短，不许改写"}

- to="person" 只在你正跟**一个人**（不是一条线）聊时用，写进他的关系记忆末尾。跟线聊时说的人的事一律 to="line"。
- [[STATE]] 和 [[MEMO]] 可以同一条回复里都报（各占一行，都在最后）。
- 它会当场记下，他随时能撤回。拿不准要不要记，记。`

/** 一行：提醒栏现在说什么。给 perLine 用，也给日志用。 */
export function stateLine(st) {
  if (!st) return '（没有这条线的事 —— 不等什么、不欠什么）'
  const due = st.due_at ? ` · 到点 ${String(st.due_at).slice(0, 10)}` : ''
  const zone = st.zone === 'stopped' ? `（连发 ${(st.followups || 0) + 1} 封没回，已停催）`
    : st.zone === 'due' ? '（到点了）' : ''
  const back = st.replied_at ? `（对方 ${String(st.replied_at).slice(0, 10)} 来信了，还没判）` : ''
  const why = st.state === 'NEEDS_REPLY' && st.why ? ` —— 凭什么：${st.why}` : ''
  return `${st.state}：${st.what || ''}${due}${zone}${back}${why}`
}

/** perLine 那段。每条线不同、一次会话内不变。 */
export function stateBlock(st) {
  return [
    '## 提醒栏现在这样说',
    stateLine(st),
    '这是按规则算的。你有全卷宗；你觉得它不对，就按「拨提醒」那条规矩改它，不用顺着它说。',
    '',
  ]
}
