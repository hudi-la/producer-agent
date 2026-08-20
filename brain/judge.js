// 判断分发器：一格一个问题。
//
// ══ 为什么不是「每封信问四件事」════════════════════════════════
//
// 因为问什么取决于**当时的 state 和来的 event**：
//   等对方回的时候来了对方的信 → 问「它解决了等的那件事吗」
//   你发出一封信              → 问「它在等对方做什么、按惯例等几天」
//   你欠着回信的时候你发了信   → 问「这封回了那件事吗」
// 通用标签器把这些压成同一个问题，判出来的就全是模糊的。
// （第一稿就是这么被推倒的。）
//
// ══ 格子从哪来 ════════════════════════════════════════════════
//
// 设计稿第四节的转移表，一格一个 prompt，问题用稿子里的原话。
// 表里没有的格子 = 还没想清楚该问什么 —— 跳过并**出声**，绝不静默。
//
// ══ 这里只有纯函数 ════════════════════════════════════════════
//
// 跟 rejudge.js / triage.js 同一个分工：prompt 和解析在这儿（可测），
// 调模型和写库在 server.js（那儿有 think 和 db）。
//
// 设计稿：docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md

import { takeTag, clean1 } from './tag.js'

/** Fairwind 开工那天。更早的往来只归属，不进转移表（稿子第十节）。 */
export const EPOCH = '2026-08-03'

/** 这条事实是转移表里的哪个 event。认不出来 = null（不该进队列的东西）。 */
export function eventOf(fact) {
  if (fact.kind === 'email') return fact.role === 'artist' ? 'MY_LETTER' : 'THEIR_LETTER'
  if (['note', 'meet', 'decision'].includes(fact.kind)) return 'NOTE'
  return null
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * 解析 [[TAG]] {...}。**成对规矩在这儿把门**（跟 parseRejudge 一个脾气）：
 *
 *   awaiting 没有 wait_days → 两个都丢（没有到点日的等待等于没设）
 *   resolves 没有理由      → 不关（悄悄关掉一个等待比多等几天坏得多）
 *   needs_reply 没有理由   → 理由填「（没说理由）」——漏一封真信比多吵一条坏
 *   meet_at 不是正经时间戳  → 丢
 *
 * 解析不出来一律 null —— null 的下场是「这条没判成，不写标签，下轮再来」。
 */
export function parseTag(text) {
  const { data } = takeTag(text, 'TAG')
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null

  const out = { gist: clean1(data.gist) }

  const awaiting = clean1(data.awaiting)
  const days = Number.isInteger(data.wait_days) && data.wait_days > 0 ? data.wait_days : null
  out.awaiting = awaiting && days ? awaiting : null
  out.wait_days = awaiting && days ? days : null

  if (data.needs_reply === true) {
    out.needs_reply = true
    out.reply_why = clean1(data.reply_why) || '（没说理由）'
  } else if (data.needs_reply === false) {
    out.needs_reply = false
    out.reply_why = null
  } else { out.needs_reply = null; out.reply_why = null }

  const why = clean1(data.resolves_why)
  out.resolves = data.resolves === true && why ? true : data.resolves === false ? false : null
  out.resolves_why = out.resolves ? why : null

  let meet = null
  if (typeof data.meet_at === 'string' && data.meet_at.trim()) {
    const s = data.meet_at.trim()
    // 只认带日期的；纯日期给个中午，免得时区一晃变昨天
    if (ISO_DAY.test(s)) meet = `${s}T12:00:00`
    else if (!Number.isNaN(Date.parse(s))) meet = s
  }
  out.meet_at = meet

  return out
}

// ── prompt 的零件 ─────────────────────────────────────────────

const CUT = 900

/** 一封信/一条笔的正文，给判断看的那份。 */
export function factText(fact) {
  const body = String(fact.body_raw || fact.content || '')
  // 剥引用尾巴：判断只该看这次说的话（跟 src/lib/letter.js 的 saidThisTime 同一个道理，
  // 这儿只做最粗的两刀 —— 判断的输入宁多勿断）
  const cut = body.split(/\n\s*On .{0,120}wrote:\s*\n/)[0].split(/\n>+ /)[0]
  return cut.slice(0, CUT)
}

const 上下文 = (fact) => {
  const rows = Array.isArray(fact.recent) ? fact.recent : []
  if (!rows.length) return '（这之前没有往来）'
  return rows.map((r) => `  ${r['日']} ${r['谁']}：${r['说']}`).join('\n')
}

const 信头 = (fact, ev) =>
  ev === 'MY_LETTER' ? `你发给 ${fact.who || '对方'} 的信（${fact.created_at?.slice(0, 10)}）`
  : ev === 'THEIR_LETTER' ? `${fact.who || '对方'} 发来的信（${fact.created_at?.slice(0, 10)}）`
  : `你记的一笔（${fact.created_at?.slice(0, 10)}）`

const 开头 = (fact, ev) => `这是「${fact.subject_name}」这条线/这个人的事。

【之前的往来】
${上下文(fact)}

【${信头(fact, ev)}】
${factText(fact)}`

const 收尾 = (fields) => `
**最后一行**单独输出，别的什么都不要加：
[[TAG]] {${fields}}`

const F_GIST = '"gist":"这封信/这笔的一句话梗概，40 字内"'
const F_REPLY = '"needs_reply":true|false,"reply_why":"凭什么要回，一句话（这句会显示给他看）"|null'
const F_WAIT = '"awaiting":"在等对方做什么"|null,"wait_days":天数|null'
const F_MEET = '"meet_at":"YYYY-MM-DDTHH:mm（当地时间）"|null'
const F_RESOLVE = '"resolves":true|false,"resolves_why":"凭什么算解决，一句话"|null'

/** 「模糊锚点落成具体日子」那套规矩，抄 rejudge 的 —— 两条线就是这么丢的。 */
const 锚点规矩 = `**模糊的时间锚点也要落成一个具体日子**：
  · "plan on 2027" → 从今天到 2027-01-05 的天数
  · "月底再联系" → 到那个月最后一周的天数
  · "秋天聊" → 到 9 月第一周的天数
对方给了时间锚点，就是真的邀请你到那时候再来一次。落不成日子它就会飘掉。`

// ── 转移表 ────────────────────────────────────────────────────
//
// 每格：{ ask(fact, state) → prompt } 或 { rule(fact) → tag }（纯规则，不花钱）。
// state = v_pa_state 那一行（what / due_at / why），IDLE 时是 null。

const due日 = (state) => state?.due_at ? String(state.due_at).slice(0, 10) : '（没定）'

export const TRANSITIONS = {
  IDLE: {
    THEIR_LETTER: { ask: (fact) => `${开头(fact, 'THEIR_LETTER')}

三个问题：
① 这封要你回吗？凭什么？（客套收尾、单纯确认、通知类的告知 = 不用回。
   你已经回过了也算不用回。**拿不准算要回。**）
② 它约了日子吗 —— 具体的见面/通话时间给 meet_at；
   对方说「某天再联系你」就是在等那一天 → awaiting=「她说＜原话＞」+ wait_days 到那天。
   ${锚点规矩}
③ 都不是 → 对应字段都 null。
${收尾(`${F_GIST},${F_REPLY},${F_WAIT},${F_MEET}`)}` },

    MY_LETTER: { ask: (fact) => `${开头(fact, 'MY_LETTER')}

一个问题：**这封信在等对方做什么吗？**
在等 → awaiting 一句话写清等什么；wait_days 按这类事的惯例给：
  投递/申请/提案 → 14 天上下；约时间、要材料、问一句 → 5 天上下；
  对方说了某天答复 → 到那天的天数。
纯告知、致谢收尾、不需要对方动作 → awaiting 和 wait_days 都 null。
顺带：信里约了具体见面时间就给 meet_at。
${收尾(`${F_GIST},${F_WAIT},${F_MEET}`)}` },

    NOTE: { ask: (fact) => `${开头(fact, 'NOTE')}

这笔说了什么？
① 见了面 / 通了话 → gist 说清跟谁、聊了什么
② 约了日子 → meet_at
③ 办完了某件事 / 只是备注 → 其余 null
${收尾(`${F_GIST},${F_MEET}`)}` },
  },

  WAITING_REPLY: {
    THEIR_LETTER: { ask: (fact, state) => `${开头(fact, 'THEIR_LETTER')}

我们在等：**${state?.what || '（没写）'}**（${due日(state)} 到点该催）。

这封信解决了它吗？
(a) 解决了 → resolves=true + resolves_why 凭什么算解决。
    然后这封信自己：要你回吗（needs_reply）？又起了新的等吗（awaiting+wait_days）？
    约了日子吗（meet_at）？
(b) 只是客套 / 说收到了、回头看 → resolves=false，其余 null。**等待继续，别动它。**
(c) 说的是别的事 → resolves=false，其余 null（等待照旧）。
${锚点规矩}
${收尾(`${F_GIST},${F_RESOLVE},${F_REPLY},${F_WAIT},${F_MEET}`)}` },

    MY_LETTER: { ask: (fact, state) => `${开头(fact, 'MY_LETTER')}

我们在等：**${state?.what || '（没写）'}**（${due日(state)} 到点）。你又发出了一封。

一个问题：这封有没有把等的事**换掉或作废**？
· 换掉了（现在等的是别的）→ awaiting=新的事 + wait_days（从这封信起算）
· 作废了（你说算了 / 不用了）→ resolves=true + resolves_why
· 都没有（催一下 / 补一句 / 说别的）→ 全 null。**计时不动 ——
  你自己再发一封不该重置倒计时，否则连发三封等于永远等不到点。**
${收尾(`${F_GIST},${F_RESOLVE},${F_WAIT}`)}` },

    NOTE: { ask: (fact, state) => `${开头(fact, 'NOTE')}

我们在等：**${state?.what || '（没写）'}**。你记了一笔。

这笔解决了它吗？（「电话里说定了」「表单已提交」「已处理」这类 = 解决了）
解决 → resolves=true + resolves_why。这笔里另约了日子 → meet_at。否则全 null。
${收尾(`${F_GIST},${F_RESOLVE},${F_MEET}`)}` },
  },

  NEEDS_REPLY: {
    MY_LETTER: { ask: (fact, state) => `${开头(fact, 'MY_LETTER')}

你欠着回：**${state?.what || '（没写）'}**。你发出了一封。

两个问题：
① 这封回了那件事吗？回了 → resolves=true + resolves_why。
   没回（发的是别的）→ resolves=false，等待照旧。
② 这封信自己在等对方做什么吗 → awaiting + wait_days（惯例：投递 14 天上下，
   约时间/问一句 5 天上下）。
${收尾(`${F_GIST},${F_RESOLVE},${F_WAIT},${F_MEET}`)}` },

    THEIR_LETTER: { ask: (fact, state) => `${开头(fact, 'THEIR_LETTER')}

你还欠着回：**${state?.what || '（没写）'}**。对方又来了一封。

现在**要回的整体**是什么？两封并一句 → needs_reply=true + reply_why（合并后的），
gist 写清对方最新说了什么。对方这封说「不用回了/自己解决了」→ resolves=true。
${收尾(`${F_GIST},${F_REPLY},${F_RESOLVE},${F_MEET}`)}` },

    // 你记了一笔 → 关（纯规则，不花钱）。「我在微信上处理了」不劳驾谁判断。
    // 视图那边（0094）看到 NEEDS_REPLY 之后有笔就自动关；这儿只把笔标成
    // 「判过了」，免得每轮重新排队。
    NOTE: { rule: (fact) => ({
      gist: String(fact.content || '').slice(0, 120) || '记了一笔',
    }) },
  },

  MEETING_SET: {
    THEIR_LETTER: { ask: (fact, state) => `${开头(fact, 'THEIR_LETTER')}

约了 **${due日(state)}** 见面（${state?.what || ''}）。对方来信。

日子变了吗？
· 改期 → meet_at=新时间；· 取消了 → resolves=true + resolves_why；
· 没提日子，但另有事要你回 → needs_reply + reply_why；· 都没有 → 全 null。
${收尾(`${F_GIST},${F_MEET},${F_RESOLVE},${F_REPLY}`)}` },

    MY_LETTER: { ask: (fact, state) => `${开头(fact, 'MY_LETTER')}

约了 **${due日(state)}** 见面。你发出了一封。

见面安排变了吗？改期 → meet_at=新时间；你取消了 → resolves=true + resolves_why；
都没有（发的是链接/材料/别的）→ 全 null。
${收尾(`${F_GIST},${F_MEET},${F_RESOLVE}`)}` },

    NOTE: { ask: (fact, state) => `${开头(fact, 'NOTE')}

约了 **${due日(state)}** 见面。你记了一笔。

这笔说的是：改期（meet_at=新时间）？取消/见完了（resolves=true + resolves_why）？
还是别的（全 null）？
${收尾(`${F_GIST},${F_MEET},${F_RESOLVE}`)}` },
  },
}

/** 查表。查不到 = 这格还没想清楚该问什么 —— 调用方必须出声，绝不静默跳过。 */
export const cellFor = (state, ev) => TRANSITIONS[state]?.[ev] || null
