// 由头 —— 「现在为什么该动这个人」。
//
// 设计稿：docs/specs/2026-08-08-people-layer-design.md 第四节
//
// 核心判断：**「多久没碰」不是引擎，「由头」才是。** 冷却时间只是排序用的，
// 它决定先找谁，但它不足以让你动笔。在美国，纯问候（just checking in /
// hope you're well）是公认最没用的邮件类型——有效的 keep-in-touch 一定带一个
// 由头：我有新作品了 / 我看到个东西想到你 / 恭喜你那个展。
//
// 所以这儿产出的不是「该问候了」（那句话没法写），是四种说得出口的理由。
//
// 原则：**能算出来的就算，算不出来的才存。** 这里全是纯函数——给它人 +
// 那个人名下的消息，回一句**带日期带来源**的人话，或者 null。
// 存下来的东西会跟事实分叉，算出来的不会。

/** 日期 → '8/6'。两位数的月日都要去前导零，不能出现「8/06」。 */
const md = (x) => {
  const d = x instanceof Date ? x : new Date(x)
  return Number.isNaN(+d) ? '?' : `${d.getMonth() + 1}/${d.getDate()}`
}
const DAY = 86400000
const daysSince = (from, to) => Math.floor((to - new Date(from)) / DAY)

/**
 * 只有邮件才算「跟外面的人的往来」。
 * 没有 gmail_message_id 的是你跟 Fairwind 的商量（role producer|artist），
 * 那不是往来——拿它当往来算，等待期会被你自己的一句嘀咕重置掉。
 */
const mailsOf = (msgs) => (msgs || []).filter((m) => m.gmail_message_id)

/**
 * 你连着发出去、中间没人回的最后几封。
 * 第一封不算「碰」，之后每一封才是——所以碰过的次数 = 这一串的长度 - 1。
 */
export function unansweredRun(msgs) {
  const mail = mailsOf(msgs)
  const run = []
  for (let i = mail.length - 1; i >= 0; i--) {
    if (mail[i].role !== 'artist') break
    run.unshift(mail[i])
  }
  return run
}

/**
 * 美国那条公认的 follow-up 节奏：约一周后碰一次，再等两三周，第三次不回就停。
 * **不回 ≠ 拒绝**，多数是淹了；但碰过三次还追就真过界了。
 */
export const BUMP_WAIT = [7, 21]

/** 见完面那封 follow-up 的时限。过了不消失，只是改口。 */
export const MEET_HOURS = 48

function bumpCue(msgs, today) {
  const run = unansweredRun(msgs)
  if (!run.length) return null
  const last = run[run.length - 1]
  const bumps = run.length - 1
  // 碰满了：**不进队列，但也不许消失**。
  // 消失 = 你以为系统还在管，其实它早放弃了 —— 那是「红点撒谎」的同一件事。
  if (bumps >= BUMP_WAIT.length) {
    return {
      via: 'bump', stopped: true,
      why: `已经碰过 ${bumps} 次，停了（最后一次 ${md(last.created_at)}）`,
    }
  }
  const waited = daysSince(last.created_at, today)
  if (waited < BUMP_WAIT[bumps]) return null
  return {
    via: 'bump',
    why: `${md(last.created_at)} 发出去，${waited} 天没回音（第 ${bumps + 1} 次碰）`,
  }
}

// 「circle back next semester」在美国语境里**是真话**——是真的邀请你在那个
// 时间点再来一次。婉拒长的是另一个样子（not a fit at this time），而且
// **不给时间锚点**。0011 那份迁移里记着两条真事：LACHSA 和 Ruth Asawa SOTA
// 都给了锚点，都因为没人记得再碰而飘掉了。
function circlebackCue(contact, today) {
  if (!contact.next_touch_at) return null
  const at = new Date(contact.next_touch_at + 'T00:00:00')
  if (Number.isNaN(+at) || at > today) return null
  return {
    via: 'circleback',
    // 日期永远说得出出处：要么是对方的原话，要么是你自己定的。没有第三种。
    why: contact.next_touch_why
      ? `${contact.next_touch_why} → ${md(at)} 到了`
      : `你定的日子到了（${md(at)}）`,
  }
}

// Warm intro 的闭环：过阵子单独回介绍人一句「跟他聊了，谢谢」。
// 大多数人不做这一步，做了的人会一直有人愿意给他介绍。
//
// 但**得等对方真回过你**：只发出去没人回，谈不上「聊上了」，
// 这时候去回谢介绍人是尴尬的。
function thanksCue(contact, msgs, introName) {
  if (!contact.intro_by || contact.intro_thanked_at) return null
  if (!mailsOf(msgs).some((m) => m.role === 'org')) return null
  return {
    via: 'thanks',
    why: `跟 ${contact.name || '他'} 聊上了，还没回谢 ${introName || '介绍人'}`,
  }
}

// Opening / artist talk / conference 是美国 networking 的主场，
// 见完 48 小时内那封 follow-up 不发，那次见面基本等于没发生。
//
// 48 小时**不是延迟，是过期提示**：过了也不消失，只是改口。
// 让它消失就等于替你决定放弃了。
function metCue(msgs, today) {
  const meets = (msgs || []).filter((m) => m.role === 'note' && m.kind === 'meet')
  if (!meets.length) return null
  const last = meets[meets.length - 1]
  const sentAfter = mailsOf(msgs).some(
    (m) => m.role === 'artist' && new Date(m.created_at) > new Date(last.created_at))
  if (sentAfter) return null
  const hrs = Math.floor((today - new Date(last.created_at)) / 3600000)
  return {
    via: 'met',
    why: hrs > MEET_HOURS
      ? `${md(last.created_at)} 见的，已经过 ${MEET_HOURS} 小时了，follow-up 还没发`
      : `${md(last.created_at)} 见过，48 小时信还没发`,
  }
}

/**
 * 这个人身上现在有哪些由头。msgs 要按 created_at 升序（loadContacts 就是这么给的）。
 *
 * today 和 introName 传得进来是为了测试能写死，也为了列表页算一次日期给所有人用。
 */
export function cuesFor(contact, msgs, { today = new Date(), introName = null } = {}) {
  return [
    bumpCue(msgs, today),
    circlebackCue(contact, today),
    thanksCue(contact, msgs, introName),
    metCue(msgs, today),
  ].filter(Boolean)
}

/** 该进队列的那些 —— 停了的只在卡上显示，不塞进你手头这摊活。 */
export const actionable = (cues) => (cues || []).filter((c) => !c.stopped)
