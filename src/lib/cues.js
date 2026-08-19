import { md, day as dayOf } from './when.js'

// 由头 —— 「现在为什么该动这个人 / 这条线」。
//
// 设计稿：docs/specs/2026-08-18-notifications-design.md
//
// ══ 这一份不看信 ═══════════════════════════════════════════════
//
// 入口从 cuesFor(contact, msgs, opts) 改成 cuesFor(facts, opts)：
// 它只看 v_pa_cue_facts 的一行标量。理由是 loadPursuits.js 开头那次事故——
// 全库消息拉进浏览器，PostgREST 封顶 1000 行，超了只给最老的 1000 条，
// 静悄悄不报错。**信不进浏览器。**
//
// 判据本身一条没改，只是数据来路换了：
//   unansweredRun(msgs).length  →  facts.unanswered_n
//   「最后一封是对方的」        →  facts.last_in_at > facts.last_out_at
//
// ══ 老规矩，一条都还算数 ═══════════════════════════════════════
//
// **「多久没碰」不是引擎，「由头」才是。** 冷却时间只决定先找谁，
// 它不足以让你动笔。在美国，纯问候（just checking in / hope you're well）
// 是公认最没用的邮件类型——有效的 keep-in-touch 一定带一个由头：
// 我有新作品了 / 我看到个东西想到你 / 恭喜你那个展。
//
// 所以这儿产出的不是「该问候了」（那句话没法写），是几种说得出口的理由。
//
// **能算出来的就算，算不出来的才存。** 存下来的东西会跟事实分叉，
// 算出来的不会。这里全是纯函数：给它一行事实，回一句**带日期带来源**
// 的人话，或者 null。
//
// 日期一律走 lib/when.js —— **全 app 只有那一份**，按你住的地方（洛杉矶）算。

const DAY = 86400000

/**
 * 差几天。**按当地的日子算，不按毫秒**——你 8/13 傍晚记的一笔，
 * 拿毫秒减会算成 8/14。两边都先落到 'YYYY-MM-DD' 再减。
 */
const daysSince = (from, to) => {
  const a = dayOf(from), b = dayOf(to)
  if (a === null || b === null) return null
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / DAY)
}

/**
 * 美国那条公认的 follow-up 节奏：约一周后碰一次，再等两三周，第三次不回就停。
 * **不回 ≠ 拒绝**，多数是淹了；但碰过三次还追就真过界了。
 */
export const BUMP_WAIT = [7, 21]

/** 见完面那封 follow-up 的时限。过了不消失，只是改口。 */
export const MEET_HOURS = 48

/**
 * 邮件类的由头归线，不归人。
 *
 * 同一段往来在人和线上各有一行事实，不拦的话会生出两条一模一样的通知
 * ——那正是「条目非常多」换个地方复发。线有标题、有阶段、有截止，
 * 上下文比人卡全，所以邮件类的归线。
 *
 * 判据锚在「最后那封信在不在某条线上」，**所以没被任何线认走的往来
 * 依然在人那行报得出来**——一条都不会丢。
 */
const 归了线 = (f) => f.subject_kind === 'contact' && Boolean(f.mail_on_line)

/**
 * 他回你了，你还没回。**最常发生、也最要紧的一条。**
 *
 * 判据：最后一封进来的比最后一封出去的晚。你回了，出去的就在后面了。
 *
 * 怎么算办完了：你回信（下次算自然就不响了），或者你按「聊过了」打个卡
 * ——有些信本来就不用回（「谢谢，回头见」），那就打卡了事，
 * 别让它一直挂着。
 */
function repliedCue(f, today) {
  if (归了线(f)) return null
  if (!f.last_in_at) return null
  if (f.last_out_at && new Date(f.last_out_at) > new Date(f.last_in_at)) return null
  // 判为不用回的：三层漏斗的第三层挡下的（「谢谢，回头见」那种）。
  // **没判过（undefined）当作要回** —— 漏一封真信比多吵一条坏得多。
  if (f.needs_reply === false) return null
  // 要回，但不是现在。日子是从他信里读出来的事实，不是系统编的
  // （brain/triage.js 明写「不许你编」）。
  if (f.not_before && f.not_before > dayOf(today)) return null
  // 你打过卡说处理过了，而且是在这封信之后 —— 不再吵你
  if (f.checkin_at && f.checkin_at >= dayOf(f.last_in_at)) return null
  const d = daysSince(f.last_in_at, today)
  return {
    via: 'replied', at: dayOf(f.last_in_at),
    // 压到今天才冒出来的那种，得说得出为什么是今天
    why: f.not_before
      ? `${md(f.last_in_at)} 他回你了，说好 ${md(f.not_before)} 再聊，到了`
      : d <= 0 ? `${md(f.last_in_at)} 他回你了，还没回`
       : `${md(f.last_in_at)} 他回你了，${d} 天没回`,
  }
}

/**
 * 你连着发出去、中间没人回的最后几封。
 * 第一封不算「碰」，之后每一封才是——所以碰过的次数 = 这一串的长度 - 1。
 *
 * **对方一回，这一串在库里就断了**（见 0072 的「没回音的」那段 CTE），
 * 这条由头自己就没了。「自动勾掉」不是一个功能，它就是这一句。
 */
function bumpCue(f, today) {
  if (归了线(f)) return null
  if (!f.unanswered_n || !f.unanswered_at) return null
  const bumps = f.unanswered_n - 1
  // 碰满了：**不进手头，但也不许消失**。
  // 消失 = 你以为系统还在管，其实它早放弃了 —— 那是「红点撒谎」的同一件事。
  if (bumps >= BUMP_WAIT.length) {
    return {
      via: 'bump', stopped: true, at: dayOf(f.unanswered_at),
      why: `已经碰过 ${bumps} 次，停了（最后一次 ${md(f.unanswered_at)}）`,
    }
  }
  const waited = daysSince(f.unanswered_at, today)
  if (waited < BUMP_WAIT[bumps]) return null
  return {
    via: 'bump', at: dayOf(f.unanswered_at),
    why: `${md(f.unanswered_at)} 发出去，${waited} 天没回音（第 ${bumps + 1} 次碰）`,
  }
}

// 「circle back next semester」在美国语境里**是真话**——是真的邀请你在那个
// 时间点再来一次。婉拒长的是另一个样子（not a fit at this time），而且
// **不给时间锚点**。0011 那份迁移里记着两条真事：LACHSA 和 Ruth Asawa SOTA
// 都给了锚点，都因为没人记得再碰而飘掉了。
function circlebackCue(f, today) {
  if (!f.next_touch_at) return null
  if (f.next_touch_at > dayOf(today)) return null
  // **到那个日子对方还没回你，才需要 follow up。**
  // 中间你俩已经聊上了，这条就不该响 —— 这正是断掉的 handleRefresh
  // 想用「收到新信时让模型判它过期」去解决的那件事。现算不需要作废。
  if (f.last_in_at && dayOf(f.last_in_at) >= f.next_touch_at) return null

  // 日期永远说得出出处。出处有两个来路：
  //   · next_touch_why —— 对方的原话（「circle back next semester」）
  //   · next_action    —— 那条待办的原文，**条件就写在这句话里**
  //     （真例：「8-12 前没回音就向 Sarah 跟进确认收到 proposal」）
  //
  // **两个都没有就不报。** 原来这儿兜底写「你定的日子到了」——
  // 而真查下来，ASU 那条 8/17 是 Fairwind 写的（next_action_by='fairwind'），
  // 根本不是你定的。**说不出出处的时候闭嘴，别挑一个说。**
  const 出处 = f.next_touch_why || f.next_action
  if (!出处) return null
  const 谁 = f.next_action_by === 'fairwind' && !f.next_touch_why ? '（它提的）' : ''
  return {
    via: 'circleback', at: f.next_touch_at,
    why: `${出处}${谁} → ${md(f.next_touch_at)} 到了`,
  }
}

// Warm intro 的闭环：过阵子单独回介绍人一句「跟他聊了，谢谢」。
// 大多数人不做这一步，做了的人会一直有人愿意给他介绍。
//
// 但**得等对方真回过你**：只发出去没人回，谈不上「聊上了」，
// 这时候去回谢介绍人是尴尬的。
function thanksCue(f) {
  if (!f.intro_by_name || f.intro_thanked_at) return null
  if (!f.org_ever_replied) return null
  return {
    // 依据是「他回过你了」，锚在他最后那封回信上
    via: 'thanks', at: dayOf(f.last_in_at),
    why: `跟 ${f.name || '他'} 聊上了，还没回谢 ${f.intro_by_name}`,
  }
}

// Opening / artist talk / conference 是美国 networking 的主场，
// 见完 48 小时内那封 follow-up 不发，那次见面基本等于没发生。
//
// 48 小时**不是延迟，是过期提示**：过了也不消失，只是改口。
// 让它消失就等于替你决定放弃了。
function metCue(f, today) {
  if (!f.last_meet_at || f.met_followed_up) return null
  const hrs = Math.floor((new Date(today) - new Date(f.last_meet_at)) / 3600000)
  return {
    via: 'met', at: dayOf(f.last_meet_at),
    why: hrs > MEET_HOURS
      ? `${md(f.last_meet_at)} 见的，已经过 ${MEET_HOURS} 小时了，follow-up 还没发`
      : `${md(f.last_meet_at)} 见过，48 小时信还没发`,
  }
}

/**
 * 这一行事实上现在有哪些由头。
 *
 * today 传得进来是为了测试能写死，也为了列表算一次给所有行用——
 * 免得渲染到一半跨过午夜，前后两半用两个「今天」。
 */
export function cuesFor(f, { today = new Date() } = {}) {
  return [
    // 「他回你了」排第一：球在你手上的时候，别的都是次要的
    repliedCue(f, today),
    bumpCue(f, today),
    circlebackCue(f, today),
    thanksCue(f),
    metCue(f, today),
  ].filter(Boolean)
}

/**
 * 一条由头的**身份**：哪个对象 + 哪一种 + 依据哪天的事实。
 *
 * 关掉 / 勾掉要存下来，就得有个稳定的键。不能拿 why 当键——
 * 「3 天没回」明天变成「4 天没回」，你今天关掉的明天又冒出来。
 * 拿 at（依据那条事实的日期）当键就对了：**他再回你一封新的，
 * at 就变了，这条由头理应重新出现**——那是新事实，不是你关过的那条。
 */
export const cueKey = (f, cue) =>
  `${f.subject_kind}|${f.subject_id}|${cue.via}|${cue.at || ''}`
