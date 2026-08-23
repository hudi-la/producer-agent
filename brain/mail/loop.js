// 一直在跑的那个循环。
//
// ══ 为什么必须有它 ═══════════════════════════════════════════════
//
// 在这之前收信完全是触发式的——而那个「触发器」还从来没接上界面：
// 「更新最新信息」跑的是按线拉 thread 的老路，**一次都没去 Gmail 收过新信**。
// 于是 8/11 那批信在库外躺了七个小时，谁也不知道。
//
// 判错还能查，没去拿是查不出来的：界面上「没有新信」和「根本没收」
// 长得一模一样。所以这件事不能靠人记得按按钮。
//
// ══ 一轮做五件事 ═══════════════════════════════════════════════
//
//   ① 收新信    history.list 增量，纯 HTTP
//   ② 判新地址  只判这轮新冒出来的（没有就一次模型都不花）
//   ③ 搬进对话表 已经认过的地址，新信拉正文写摘要落库
//   ④ 认亲      RFC References → 这封回的是我哪条线的信（纯 SQL）
//   ⑤ 归属      机械层接不住的，问一次模型（多数轮次这一步是空的）
//
// ①②④ 几乎不花钱。③ 只对你认过的地址走，④⑤ 只在真有活时才走。
//
// ③ 是补上的：原来只有你**点头认地址**的那一刻搬一次，之后那个人的
// 每一封新信都停在账本里。认领是一次性的，搬运得每轮做。

import { incremental, auditPass } from './sync.js'
import { classify } from './classify.js'
import { carryPass } from './carry.js'
import { attributePass } from './attribute.js'
import { db } from './store.js'
import { MailAuthError } from './auth.js'

// 上一轮的结果。界面靠它说「上次收信是什么时候、出了什么事」。
let last = { at: null, ok: null, note: '还没跑过', detail: null }
let running = false

// 兜底：不看这轮碰了谁，把认过的地址全查一遍谁还欠着信。
//
// 平时只搬「这轮碰到的地址」，快，但漏了就永远漏了——某个地址那次拉正文
// 正好赶上 Gmail 抽风，它不会再被碰到第二次。兜底是这种漏的唯一出口。
//
// 第一轮必做（进程刚起，谁知道停机期间攒了什么），之后每 12 轮一次 ≈ 每小时。
const FULL_EVERY = 12
let sweeps = 0

export const lastSweep = () => ({ ...last, running })

async function rpc(fn, args) {
  const { data, error } = await db().rpc(fn, args)
  if (error) throw new Error(`${fn} 失败：${error.message}`)
  return data
}

/**
 * 跑一轮。
 *
 * 不重入：上一轮没跑完就跳过这一轮。回填后的第一轮可能要判几百个地址，
 * 那要十几分钟——期间定时器还会敲好几次，重入的话会同时跑好几份，
 * 互相抢 Gmail 配额，也会把同一批地址判两遍。
 */
export async function sweepMail({ log = console.log, classifyRounds = 2 } = {}) {
  if (running) return { skipped: true, note: '上一轮还没跑完' }
  running = true
  const t0 = Date.now()
  const full = sweeps++ % FULL_EVERY === 0     // 第一轮（0）必扫
  const out = { added: 0, judged: 0, carried: 0, linked: 0, attached: 0 }
  try {
    // ① 收新信
    const sync = await incremental({ log: () => {} })
    out.added = Number(sync.added || 0)
    if (sync.skipped) { out.note = sync.note }
    if (sync.rebuilt) out.rebuilt = true

    // ①.5 补核：预约发送的信真发出那刻只是标签翻成 SENT（labelAdded），
    // 增量只听 messageAdded 听不见 —— 每轮把「时间已过、没核过标签」的
    // 拿一次标签写审计。队列平时是空的，一次 SQL 而已。
    try { const a = await auditPass({ log: () => {} }); if (a.audited) out.audited = a.audited }
    catch (err) { console.warn('  ⚠️ 补核标签没走成：' + err.message) }

    // ② 判新地址。没有新地址就一次模型都不花——这是常态。
    const left = await rpc('pa_mail_rule_pass')
    out.rule = left
    if (Number(left?.left || 0) > 0) {
      const c = await classify({ rounds: classifyRounds, log: () => {} })
      out.judged = (c.person || 0) + (c.shared_box || 0) + (c.bulk || 0) + (c.machine || 0) + (c.unsure || 0)
    }

    // ③ 搬进对话表：只对你已经认过的地址。没认过的一封都不搬。
    const carry = await carryPass({ touched: full ? null : (sync.touched || []), log: () => {} })
    out.carried = carry.added || 0
    if (carry.failed?.length) out.carryFailed = carry.failed
    if (carry.deferred) out.carryDeferred = carry.deferred

    // ④ 认亲：纯 SQL，零成本，每轮都跑
    const link = await rpc('pa_link_replies')
    out.linked = Number(link?.linked || 0)

    // ⑤ 归属：只在真有孤儿来信时才问模型
    const attr = await attributePass({ apply: true, log: () => {} })
    out.attached = (attr.attached || []).length
    out.pending = (attr.low || []).length

    last = {
      at: new Date().toISOString(), ok: true, detail: out,
      note: out.added ? `收到 ${out.added} 封新信` : '没有新信',
    }
    const ms = Date.now() - t0
    if (out.added || out.judged || out.carried || out.linked || out.attached) {
      log(`  ↳ 邮件：新信 ${out.added}｜判地址 ${out.judged}｜进对话 ${out.carried}｜认亲 ${out.linked}｜归线 ${out.attached}（${(ms / 1000).toFixed(1)}s）`)
    }
    return out
  } catch (err) {
    // **授权掉了要吼出来**，不能长成「没有新信」。这次事故最伤人的
    // 就是失败和无事发生长得一样。
    const authed = err instanceof MailAuthError
    last = {
      at: new Date().toISOString(), ok: false, detail: null,
      note: authed ? `Gmail 授权掉了：${err.message}` : `收信出错：${err.message}`,
      needsAuth: authed, fix: err.fix || null,
    }
    console.error(`  ✗ 邮件那一轮挂了：${err.message}`)
    return { error: err.message, needsAuth: authed }
  } finally {
    running = false
  }
}
