// 搬运：把已经认过的地址名下的新信，从信头账本搬进对话表。
//
// ══ 为什么循环里必须有这一步 ═══════════════════════════════════
//
// 认领是一次性的，搬运却得每轮都做——这两件事原来混成了一件。
//
// adopt.js 的 promote() 只在你**点头认一个地址**的那一刻跑一次。Stacy
// 早就认过了，所以从那以后她的每一封新信都停在账本里：
//
//   8/13 下午你给她发的三封    信头账本 ✓   对话表 ✗
//
// 而机会线卡片上的「新来信」读的是账本（推导视图），所以信号是亮的。
// **系统告诉你有信，你点进去却看不见**——这比不告诉你更糟。
//
// ══ 只搬你认过的 ═══════════════════════════════════════════════
//
// pa_mail_promote 这个口子**不把门**：拿 noreply@github.com 去问，它照样
// 返回 33 行。把门是调用方的事，就在这个文件里。没认过的地址一封都不搬，
// 继续躺在账本里等你点头——那道闸是「还不认识的地址」那一页，不是这儿。
//
// 所以这一步永远不花模型钱去判**是谁的信**；只有搬的时候写摘要那一次
// 才过模型，而那是你认这个人的时候就同意了的事。
//
// ══ 两条路 ═════════════════════════════════════════════════════
//
//   平时   只看这一轮新进账本的信涉及的地址（通常 0–3 个）
//   兜底   把认过的地址全查一遍，看谁名下还有没搬的
//
// 兜底存在的唯一理由是**漏了的那些**：某个地址那次拉正文正好赶上 Gmail
// 抽风，它不会再被「碰到」第二次，平时那条路永远救不了它。
//
// 查一个地址有没有待搬的只要一次 SQL（117 个地址几秒钟），所以兜底**查全部**；
// 贵的是拉正文写摘要，所以只有**搬**这一步限量。这样限了量也不会饿死谁：
// 每次兜底都重新算一遍真实待搬集合，搬掉的就从集合里消失了。

import { promote } from './adopt.js'
import { db, toPromote } from './store.js'

// 一轮最多搬几个地址。停机几天后重开，待搬的可能有几十个地址，每个都要
// 拉正文写摘要——那会把一轮拖成十几分钟。剩下的下一轮接着搬，不会丢。
const MAX_PER_SWEEP = 12

/** 已经认过的地址：通讯录里的人 + 登记过的机构信箱。 */
export async function knownAddresses() {
  const [ce, om] = await Promise.all([
    db().from('v_pa_contact_emails').select('email'),
    db().from('v_pa_org_mailboxes').select('email'),
  ])
  if (ce.error) throw new Error('读通讯录地址失败：' + ce.error.message)
  if (om.error) throw new Error('读机构信箱失败：' + om.error.message)
  const out = new Set()
  for (const r of [...(ce.data || []), ...(om.data || [])]) {
    const e = String(r.email || '').trim().toLowerCase()
    if (e) out.add(e)
  }
  return out
}

/**
 * 这一轮碰到的地址里，哪些是该搬的。纯函数，好测。
 *
 * **永远先跟 known 求交集**：把门就在这一行，没有第二处。
 */
export function pickAddresses(touched, known, cap = MAX_PER_SWEEP) {
  const hit = [...new Set((touched || []).map((e) => String(e || '').trim().toLowerCase()))]
    .filter((e) => e && known.has(e))
  return { take: hit.slice(0, cap), deferred: hit.slice(cap) }
}

/** 兜底：认过的地址里，谁名下还有没搬进对话表的信。一个地址一次 SQL。 */
export async function pendingAddresses(known) {
  const out = []
  for (const email of [...known].sort()) {
    try {
      if ((await toPromote(email)).length) out.push(email)
    } catch (_) {
      // 查不动的下一轮再说，别让一个地址挡住整次兜底
    }
  }
  return out
}

/**
 * 搬一轮。
 *
 * @param touched 这一轮新进账本的信涉及的地址；不传 = 兜底全查
 */
export async function carryPass({ touched = null, log = console.log } = {}) {
  const known = await knownAddresses()
  let take, deferred
  if (touched == null) {
    const all = await pendingAddresses(known)
    take = all.slice(0, MAX_PER_SWEEP)
    deferred = all.slice(MAX_PER_SWEEP)
  } else {
    ;({ take, deferred } = pickAddresses(touched, known))
  }

  // 没有截断就别报——「这轮推迟了 0 个」是噪音。有截断必须报：
  // 悄悄砍掉一半，日志看起来就跟全搬完了一模一样。
  if (deferred.length) log(`  ↳ 这轮先搬 ${take.length} 个地址，还剩 ${deferred.length} 个下一轮`)
  if (!take.length) return { addresses: 0, promoted: 0, added: 0, failed: [], succeeded: [], deferred: deferred.length }

  let promoted = 0, added = 0
  const failed = []
  const succeeded = []
  for (const email of take) {
    try {
      const r = await promote(email, { log: () => {} })
      succeeded.push(email)
      promoted += r.promoted || 0
      added += r.added || 0
      if (r.added) log(`  ✓ ${email}：搬进对话表 ${r.added} 封`)
    } catch (err) {
      // 一个地址搬砸了不该带走整轮。下次兜底会重新算出它还欠着——
      // 这正是兜底存在的理由。
      failed.push(email)
      log(`  ✗ ${email} 没搬成：${err.message}`)
    }
  }
  return { addresses: take.length, promoted, added, failed, succeeded, deferred: deferred.length }
}
