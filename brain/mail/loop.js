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
import { archiveFailures, archiveWarning } from './archive-status.js'
import { attributePass } from './attribute.js'
import { copiedPass } from './copied.js'
import { groupNamesPass } from './groups.js'
import { db } from './store.js'
import { MailAuthError } from './auth.js'
import { currentTenant } from '../tenant.js'
import { outputLang } from '../prompt.js'

import { chatgptStatus } from '../engine/codex.js'

/**
 * 这个人选的那家模型,凭据齐了没(跟 hosted/routes.js 的 readyOf 同一个判断)。
 * ChatGPT 订阅没有存在设置里的 key:登录凭证在服务器上这个人自己的目录里,得去那儿看
 * (原来看 settings.chatgptConnected——设置里根本没这一格,接了 ChatGPT 订阅也被当成「没接模型」,10/8 测试撞上)
 */
async function modelReady(t) {
  const s = t?.settings || {}
  if (s.provider === 'chatgpt-subscription') {
    try { return Boolean((await chatgptStatus(t.dataDir)).connected) } catch { return false }
  }
  return Boolean(s.provider === 'claude-subscription' ? s.oauthToken : s.provider === 'openai' ? s.openaiKey : s.provider === 'gemini' ? s.geminiKey : s.apiKey)
}

// 上一轮的结果。界面靠它说「上次收信是什么时候、出了什么事」。
//
// 线上(2026-10-06 设计稿 D6)一个进程替好多人收信,这三样得按人分开——
// 不然 A 的「收到 3 封」会显示在 B 的界面上,A 跑着的时候 B 那一轮也被当成「上一轮没跑完」跳过。
// hosted 存在那个人的 marks 里;个人版 / 本机版只有一个人,还是这一份。
// 顶栏「收信状态」那句是这儿写好了递给页面的——按这个人的语言写(2026-10-08)
const L = (zh, en) => (outputLang() === 'en' ? en : zh)
const fresh = () => ({ last: { at: null, ok: null, note: L('还没跑过', 'Not run yet'), detail: null }, running: false, sweeps: 0 })
const SOLO = fresh()
function S() {
  const t = currentTenant()
  if (t?.mode !== 'hosted' || !t.marks) return SOLO
  if (!t.marks.mailLoop) t.marks.mailLoop = fresh()
  return t.marks.mailLoop
}

// 兜底：不看这轮碰了谁，把认过的地址全查一遍谁还欠着信。
//
// 平时只搬「这轮碰到的地址」，快，但漏了就永远漏了——某个地址那次拉正文
// 正好赶上 Gmail 抽风，它不会再被碰到第二次。兜底是这种漏的唯一出口。
//
// 第一轮必做（进程刚起，谁知道停机期间攒了什么），之后每 12 轮一次 ≈ 每小时。
const FULL_EVERY = 12

export const lastSweep = () => { const st = S(); return { ...st.last, running: st.running, backfill: st.backfill || null, judging: st.judging || null, blocked: st.blocked || null, found: st.found ?? null, foundBoxes: st.foundBoxes ?? null } }

/** 认出了几个在跟你谈事的真人(还没进通讯录的)。右下角小窗那句「找到 M 个真人联系人」用它 */
async function countFound() {
  const n = async (kind) => { try { const { count } = await db().from('v_pa_unknown_senders').select('email', { count: 'exact', head: true }).eq('判定', kind); return count ?? null } catch { return null } }
  return { people: await n('person'), boxes: await n('shared_box') }
}

/**
 * 第一次收信(回填)走到哪了。页面右下角那个小窗靠它(2026-10-07 他要的:「用户遇到这个事情,得有个等待的小窗口显示着」)。
 *   { phase: 'listing', got }                  在数信箱里有多少封
 *   { phase: 'fetching', done, total, since }  在拉信头
 *   { phase: 'waiting', note }                 这一轮没成(多半是 Google 限速),下一轮接着
 *   { phase: 'done', total, at }               搬完了——页面显示一小会儿就收起
 * 传 null 清掉。
 */
export function setBackfill(p) { S().backfill = p ? { ...p, updated: new Date().toISOString() } : null }

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
  const st = S()
  if (st.running) return { skipped: true, note: '上一轮还没跑完' }
  st.running = true
  const t0 = Date.now()
  const full = st.sweeps++ % FULL_EVERY === 0     // 第一轮（0）必扫
  const out = { added: 0, judged: 0, carried: 0, linked: 0, attached: 0 }
  try {
    // ① 收新信
    const sync = await incremental({ log: () => {} })
    out.added = Number(sync.added || 0)
    if (sync.skipped) { out.note = sync.note }
    if (sync.rebuilt) out.rebuilt = true

    // ①.5 补核：预约发送的信真发出那刻只是标签翻成 SENT（labelAdded）——
    // 每轮把「时间已过、没核过标签」的拿一次标签写审计。队列平时是空的，
    // 一次 SQL 而已。（增量现在也收标签事件了，见 gmail.js 的 idsFromHistory；
    // 这一条留着兜「事件早过去了、游标已经推过」的那些。）
    try { const a = await auditPass({ log: () => {} }); if (a.audited) out.audited = a.audited }
    catch (err) { console.warn('  ⚠️ 补核标签没走成：' + err.message) }

    // ② 判新地址。没有新地址就一次模型都不花——这是常态。
    //
    // 2026-10-07:第一次连上信箱时这里有几百上千个地址要判,右下角小窗得说判到哪了(st.judging);
    // 中途额度用完(QuotaError)记在 st.blocked,到重置时间之前不再白敲,到点自己接着——不用人管。
    const left = await rpc('pa_mail_rule_pass')
    out.rule = left
    const nLeft = Number(left?.left || 0)
    // 还没接模型(线上新用户常见):信照样筛,认人这一步要模型——别悄悄失败,记下来让小窗说「去设置接上模型」。
    // 接上之后下一轮自己接着
    const tt = currentTenant()
    if (nLeft > 0 && tt?.mode === 'hosted' && !(await modelReady(tt))) {
      if (!st.judging || st.judging.done) st.judging = { total: nLeft, left: nLeft, since: new Date().toISOString() }
      st.blocked = { kind: 'nomodel', at: new Date().toISOString() }
    } else if (st.blocked?.kind === 'nomodel') st.blocked = null
    const waitUntil = st.blocked?.kind === 'nomodel' ? Infinity : st.blocked?.resetAt ? Date.parse(st.blocked.resetAt) : st.blocked ? Date.parse(st.blocked.at) + 30 * 60_000 : 0
    if (nLeft > 0 && Date.now() < waitUntil) {
      out.note = st.blocked?.kind === 'nomodel' ? '还没接模型,认人这一步等着' : '模型额度用完了,等重置'
    } else if (nLeft > 0) {
      if (!st.judging || st.judging.done) st.judging = { total: nLeft, left: nLeft, since: new Date().toISOString() }
      st.judging.total = Math.max(st.judging.total, nLeft)
      // 积压多的时候一轮多判几批(第一次连上),平时两批就够
      const c = await classify({ rounds: nLeft > 100 ? 6 : classifyRounds, log: () => {} })
      out.judged = (c.person || 0) + (c.shared_box || 0) + (c.bulk || 0) + (c.machine || 0) + (c.unsure || 0)
      const after = Math.max(0, nLeft - out.judged)
      if (c.blocked) st.blocked = { ...c.blocked, at: new Date().toISOString() }
      else st.blocked = null
      st.judging = after > 0 ? { ...st.judging, left: after } : { total: st.judging.total, left: 0, done: true, at: new Date().toISOString() }
      { const f = await countFound(); st.found = f.people; st.foundBoxes = f.boxes }
    } else if (st.judging && !st.judging.done) {
      st.judging = { total: st.judging.total, left: 0, done: true, at: new Date().toISOString() }
      st.blocked = null
    }

    // ③ 搬进对话表：只对你已经认过的地址。没认过的一封都不搬。
    const carry = await carryPass({ touched: full ? null : [...(st.archiveFailures || []), ...(sync.touched || [])], log: () => {} })
    st.archiveFailures = archiveFailures(st.archiveFailures, carry)
    out.carried = carry.added || 0
    if (carry.failed?.length) out.carryFailed = carry.failed
    if (carry.deferred) out.carryDeferred = carry.deferred

    // ④ 认亲：纯 SQL，零成本，每轮都跑
    const link = await rpc('pa_link_replies')
    out.linked = Number(link?.linked || 0)

    // ④.5 同机构的另一个信箱回到你的线里 → 自动登记 + 当场搬信（0115）。
    // 真事：Descanso 的 programs@ 回了你发给 visitorcenter@ 的提案，
    // 三封信堵在账本里，通知无声。规则级证据不劳他点头；
    // 「人」不走这条 —— 名片该谁点头还是谁点头。
    try {
      const adopted = await rpc('pa_adopt_replying_mailboxes')
      if (adopted?.length) {
        log(`  ↳ 收编同机构信箱：${adopted.map((a) => a.email).join('、')}`)
        const c2 = await carryPass({ touched: adopted.map((a) => a.email), log: () => {} })
        st.archiveFailures = archiveFailures(st.archiveFailures, c2)
        out.carried += c2.added || 0
      }
    } catch (err) { console.warn('  ⚠️ 收编信箱没走成：' + err.message) }

    // ④.6 抄送栏里的人、同机构回信的人 → 自动进通讯录、挂上线（0121）。
    // 真事：Brooke 回信抄送了 Rachel，Lorna 抄送了 Meighan，Meighan 自己回信
    // 还被休假自动回复连累判成「群发」—— 三个人系统里一个都没有。
    // 同机构 + 有人名署名是规则级证据，不劳他点头；其余进「新联系人」面板。
    try {
      const cp = await copiedPass({ log: () => {} })
      out.copied = (cp.adopted || []).length
      out.carried += cp.carried || 0
      if (cp.adopted?.length) log(`  ↳ 收进抄送的人：${cp.adopted.map((a) => `${a.name}（${a.title}）`).join('、')}`)
      if (cp.greeted?.length) log(`  ↳ 端给你点头：${cp.greeted.map((g) => g.email).join('、')}`)
    } catch (err) { console.warn('  ⚠️ 收抄送的人没走成：' + err.message) }

    // ④.7 一伙人（0122）：只补老信的署名，收不收由他在「等你点头」里点。
    try { await groupNamesPass({ log }) }
    catch (err) { console.warn('  ⚠️ 一伙人补署名没走成：' + err.message) }

    // ⑤ 归属：只在真有孤儿来信时才问模型
    const attr = await attributePass({ apply: true, log: () => {} })
    out.attached = (attr.attached || []).length
    out.pending = (attr.low || []).length

    const archiveProblem = archiveWarning(st.archiveFailures, outputLang() === 'en')
    st.last = {
      at: new Date().toISOString(), ok: !archiveProblem, detail: out,
      note: out.added ? L(`收到 ${out.added} 封新信`, `${out.added} new email${out.added > 1 ? 's' : ''}`) : L('没有新信', 'No new mail'),
      ...(archiveProblem || {}),
    }
    const ms = Date.now() - t0
    if (out.added || out.judged || out.carried || out.linked || out.attached || out.copied) {
      log(`  ↳ 邮件：新信 ${out.added}｜判地址 ${out.judged}｜进对话 ${out.carried}｜认亲 ${out.linked}｜归线 ${out.attached}｜抄送的人 ${out.copied || 0}（${(ms / 1000).toFixed(1)}s）`)
    }
    return out
  } catch (err) {
    // **授权掉了要吼出来**，不能长成「没有新信」。这次事故最伤人的
    // 就是失败和无事发生长得一样。
    const authed = err instanceof MailAuthError
    st.last = {
      at: new Date().toISOString(), ok: false, detail: null,
      note: authed ? L(`Gmail 授权掉了：${err.message}`, `Gmail access was lost: ${err.message}`) : L(`收信出错：${err.message}`, `Fetching mail failed: ${err.message}`),
      needsAuth: authed, fix: err.fix || null,
    }
    console.error(`  ✗ 邮件那一轮挂了：${err.message}`)
    return { error: err.message, needsAuth: authed }
  } finally {
    st.running = false
  }
}
