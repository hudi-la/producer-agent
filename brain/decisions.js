// 决定闸门：模型提议的改动，落库之前先过这里的硬规则（2026-10-24）。
//
// 模型在回复末尾报 [[STATE]] / [[MEMO]]，这是「它提议」。过去提议一律当场落地，
// 体检查到三种错：
//   ① 你问的一句话（「这个是什么啊」「has anyone been awarded…」）被当成「决定笔」的正文
//      记进时间线，之后作为「线下事实」喂给每一次判断。
//   ② 后台到点任务在你不在场时改提醒，13 次理由写着「已发出跟进」，其实一封都没发——
//      它把自己起草当成了发出。
//   ③ 商量被记成记忆（「你帮我查一查……」）。
//
// 规则（纯函数，可测；落库在 server.js）：
//   · 后台（没有人在场）只提议，不落地。气泡下出一张「建议」卡，你按「采纳」才落。
//   · 理由里声称「已发出 / 已回复」的，必须在真实邮件里找得到对应的信，找不到只提议。
//   · 你这句话是提问或请求时：记忆不记；提醒照常可改，但笔的正文不用你的问句。
//   · 其余情况保持他定的规矩：聊天里定的，默认落地、按了能撤回。

import { isSentMail } from '../src/lib/messageKinds.js'

const ASK_END = /[?？]\s*$|[吗呢吧么嘛]\s*[?？。.!！]?\s*$/
const ASK_START_ZH = /^(请|帮我|帮忙|麻烦|你(帮|看|觉得|能|可以|去|查|想|再)|能不能|可不可以|可以帮|要不要|是不是|怎么|为什么|什么|哪|多少|几|如何|需要什么|起草|写一|查一|看看|找一|跟他说|跟她说|告诉)/
// 英文的词边界 \b 只对英文有用；中文字之间没有「词边界」，所以中英分两条
const ASK_START_EN = /^(can you|could you|would you|please|help me|what|why|how|when|where|who|which|is there|are there|has anyone|have you|do you|does|should i|should we|find|look up|search|check|write|draft|tell|give|make|translate|refine)\b/i
const ASK_WORD = /(什么|怎么|为什么|哪[里个些儿]|多少|是否|要不要|能不能|行不行|可不可以|有没有)/
// 疑问词只在短句里算数：长句里的「是否」「行不行」多半是在转述（「我问他周五行不行」）
// 「帮我记一下」是在要求记录——它本身就是一件要记的事，不算提问
const RECORD = /(记一下|记下|记住|帮我记|你记|note (that|this|down)|remember (that|this))/i

/** 这句话是在问、在请求，而不是在陈述一件事。宁可多认成「问」：认错的代价只是笔的正文换成小卡那行字、记忆不记。 */
export function looksLikeAsk(text) {
  const s = String(text || '').trim()
  if (!s) return false
  if (RECORD.test(s)) return false
  const first = s.split(/\n/)[0].trim()
  return ASK_END.test(first) || ASK_END.test(s) || ASK_START_ZH.test(first) || ASK_START_EN.test(first) || (first.length <= 16 && ASK_WORD.test(first))
}

const SENT_CLAIM = /((已经?|刚刚?|今天|昨天)\s*(发|寄|回|跟进))|发出|发了|发过|寄出|回复了|跟进了|\b(sent|replied|followed up|emailed)\b/i

/** 理由里声称「已经发出 / 回复了」。 */
export const claimsSent = (why) => SENT_CLAIM.test(String(why || ''))

/** 最近 days 天里有没有一封真的发出去的信（Gmail 同步来的，或页面上发的）。 */
export function sentWithin(msgs = [], days = 3, now = new Date()) {
  const since = now.getTime() - days * 86400000
  return msgs.some((m) => isSentMail(m, now) && !m.deleted_at && new Date(m.created_at || 0).getTime() >= since)
}

/**
 * 一个 [[STATE]] 提议能不能当场落地。
 * source: 'chat'（你刚说了一句）| 'timer'（后台到点，没人在场）
 * 返回 { apply, reason, noteText }。apply=false 时界面画「建议」卡，等你采纳。
 */
export function gateStateMove({ move, source, userText = null, msgs = [], now = new Date() }) {
  if (!move) return { apply: false, reason: 'no-move', noteText: null }
  if (source !== 'chat') return { apply: false, reason: 'background', noteText: null }
  if (claimsSent(move.why) && !sentWithin(msgs, 3, now)) return { apply: false, reason: 'unverified-send', noteText: null }
  const noteText = userText && !looksLikeAsk(userText) ? userText : null
  return { apply: true, reason: 'chat', noteText }
}

/** 一个 [[MEMO]] 提议能不能落地：只记你陈述的事，问句和请求不记。 */
export function gateMemo({ memo, userText = '' }) {
  if (!memo) return { apply: false, reason: 'no-memo' }
  if (looksLikeAsk(userText)) return { apply: false, reason: 'question' }
  return { apply: true, reason: 'statement' }
}

/** 界面和日志用的一句话：为什么这次只是建议。 */
export const GATE_WHY = {
  background: '后台到点时提的，你不在场，等你看过再改',
  'unverified-send': '理由里说「已发出」，但邮件记录里没找到这封信',
}
