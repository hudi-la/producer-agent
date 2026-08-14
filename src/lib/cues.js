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

/**
 * 日期 → '8/6'。两位数的月日都要去前导零，不能出现「8/06」。
 *
 * **按 UTC 取月日，不按本地时区。** 库里的 last_touch_at 是 created_at::date
 * 算出来的（UTC 日），名片和通讯录都显示那一个。这儿要是按本地时区格式化，
 * 一封 UTC 凌晨到的信会被说成前一天——于是由头写着「8/5 他回你了」，
 * 同一页的通讯录那行写着「8/6」。同一封信两个日期，你不知道该信哪个。
 */
const md = (x) => {
  const d = x instanceof Date ? x : new Date(x)
  return Number.isNaN(+d) ? '?' : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}
/** 日期 → 'YYYY-MM-DD'（UTC）。由头的**身份**靠它 —— 见下面 at 那一段。 */
const dayOf = (x) => {
  const d = x instanceof Date ? x : new Date(x)
  return Number.isNaN(+d) ? null : d.toISOString().slice(0, 10)
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

/**
 * 他回你了，你还没回。
 *
 * 这条是**最常发生、也最要紧的一条**，而我一开始定四种由头时把它漏了——
 * 漏得很没道理：机会线那边早就有这个判据（收到来信就进队，见 App.jsx 的
 * needsMe），人这边偏偏没接上。而「Maisa 回了我，我该回他」正是这一整刀
 * 最开始要解决的那件事。
 *
 * 判据：往来里最后一封邮件是对方发的。就这么简单——你回了，最后一封就是你的了。
 *
 * 怎么算办完了：你回信（下次收信自然就不响了），或者你按「聊过了」打个卡
 * ——有些信本来就不用回（「谢谢，回头见」），那就打卡了事，别让它一直挂着。
 */
function repliedCue(contact, msgs, today) {
  const mail = mailsOf(msgs)
  const last = mail[mail.length - 1]
  if (!last || last.role !== 'artist' && last.role !== 'org') return null
  if (last.role !== 'org') return null                    // 最后一封是你发的，轮不到这条
  // 你打过卡说处理过了，而且是在这封信之后 —— 不再吵你
  if (contact.last_touch_src === 'checkin' && contact.last_touch_at &&
      new Date(contact.last_touch_at + 'T23:59:59') >= new Date(last.created_at)) return null
  const d = daysSince(last.created_at, today)
  return {
    via: 'replied', at: dayOf(last.created_at),
    why: d <= 0 ? `${md(last.created_at)} 他回你了，还没回`
       : `${md(last.created_at)} 他回你了，${d} 天没回`,
  }
}

function bumpCue(msgs, today) {
  const run = unansweredRun(msgs)
  if (!run.length) return null
  const last = run[run.length - 1]
  const bumps = run.length - 1
  // 碰满了：**不进队列，但也不许消失**。
  // 消失 = 你以为系统还在管，其实它早放弃了 —— 那是「红点撒谎」的同一件事。
  if (bumps >= BUMP_WAIT.length) {
    return {
      via: 'bump', stopped: true, at: dayOf(last.created_at),
      why: `已经碰过 ${bumps} 次，停了（最后一次 ${md(last.created_at)}）`,
    }
  }
  const waited = daysSince(last.created_at, today)
  if (waited < BUMP_WAIT[bumps]) return null
  return {
    via: 'bump', at: dayOf(last.created_at),
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
    via: 'circleback', at: contact.next_touch_at,
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
    // 依据是「他回过你了」，锚在他最后那封回信上
    at: dayOf(mailsOf(msgs).filter((m) => m.role === 'org').at(-1)?.created_at),
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
    via: 'met', at: dayOf(last.created_at),
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
    // 「他回你了」排第一：球在你手上的时候，别的都是次要的
    repliedCue(contact, msgs, today),
    bumpCue(msgs, today),
    circlebackCue(contact, today),
    thanksCue(contact, msgs, introName),
    metCue(msgs, today),
  ].filter(Boolean)
}

/**
 * 一条由头的**身份**：谁 + 哪一种 + 依据哪天的事实。
 *
 * 关掉一条由头要存下来，就得有个稳定的键。不能拿 why 当键——
 * 「3 天没回」明天变成「4 天没回」，你今天关掉的明天又冒出来。
 * 拿 at（依据那条事实的日期）当键就对了：**他再回你一封新的，
 * at 就变了，这条由头理应重新出现**——那是新事实，不是你关过的那条。
 */
export const cueKey = (contactId, cue) => `${contactId}|${cue.via}|${cue.at || ''}`

/** 该进队列的那些 —— 停了的只在卡上显示，不塞进你手头这摊活。 */
export const actionable = (cues) => (cues || []).filter((c) => !c.stopped)
