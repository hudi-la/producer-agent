// Gmail API 的薄壳。**纯 HTTP，一次模型都不过。**
//
// 这一层存在的意义就是把「抓取」和「理解」分开。以前两件事焊死在
// think() 里，于是取一万封信 = 一万次模型往返，根本跑不动。分开之后：
// 全量回填是几分钟的 HTTP，模型只在「这个地址背后是谁」那一步出场。
//
// 三条实现上的规矩：
//   · 分页永远走到底，不偷偷截断——漏掉的信在界面上长得跟「没有这封信」
//     一模一样，那是这次事故里最伤人的失败形态。
//   · 429 / 5xx 退避重试，不当成「没有」。
//   · 并发有上限。Gmail 的配额很宽（messages.get 才 5 个单位），瓶颈是
//     本机的 socket 和对方的限流，不是额度。

import { google } from 'googleapis'
import { asAuthErrorIfItIs } from './auth.js'
import { WANT_HEADERS } from './addr.js'

const CONCURRENCY = 10
const MAX_TRIES = 5

export function gmailFor(auth) {
  return google.gmail({ version: 'v1', auth })
}

// ── 限速(2026-10-07)───────────────────────────────────────────
// Gmail 每个信箱每分钟有额度(15000 单位,messages.get 一次 5 单位 → 一分钟最多 3000 封)。
// 回填并发 10 路不加节制,几秒就冲穿——线上第一轮回填就这么整轮作废了。而且额度按「Google 项目 + 信箱」算,
// 个人版和线上版用同一个项目、同一个信箱时是**共用**一份。所以这儿留足余量:每秒最多 RATE 次(25 次时线上还是频频撞额度,10/7 降到 10)。
const RATE = Number(process.env.GMAIL_RATE || 10)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pacers = new WeakMap()                     // gmail 客户端 → { next, pauseUntil }
function pacerOf(gmail) {
  if (!gmail || typeof gmail !== 'object') return null
  if (!pacers.has(gmail)) pacers.set(gmail, { next: 0, pauseUntil: 0 })
  return pacers.get(gmail)
}
async function pace(p) {
  if (!p) return
  const now = Date.now()
  const at = Math.max(now, p.next, p.pauseUntil)
  p.next = at + 1000 / RATE
  if (at > now) await sleep(at - now)
}
/** 「每分钟额度用完」:等几秒没用,要等到下一分钟 */
export function isPerMinuteQuota(err) {
  const e = err?.response?.data?.error
  const text = `${e?.errors?.[0]?.reason || ''} ${e?.message || err?.message || ''}`
  return /per minute|rateLimitExceeded|userRateLimitExceeded/i.test(text)
}

/** 退避重试。只重试「再试一次可能就好」的那几种，别的直接抛。gmail 给了就按它限速(同一个客户端的并发共用一个节拍) */
async function retry(fn, what, gmail = null) {
  const p = pacerOf(gmail)
  let last
  for (let i = 0; i < MAX_TRIES; i++) {
    try {
      await pace(p)
      return await fn()
    } catch (err) {
      const authed = asAuthErrorIfItIs(err)
      if (authed.name === 'MailAuthError') throw authed        // 授权掉了，重试也没用
      const code = err?.response?.status ?? err?.code
      const retryable = code === 429 || code === 403 || (code >= 500 && code < 600)
        || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
      if (!retryable) throw err
      last = err
      if (isPerMinuteQuota(err)) {
        // 一分钟的额度用完了:整个客户端一起停到下一分钟(不然别的几路接着撞),再接着来
        const wait = 61_000 + Math.floor(Math.random() * 4000)
        if (p) p.pauseUntil = Math.max(p.pauseUntil, Date.now() + wait)
        console.warn(`  ↻ ${what} 碰到每分钟额度，停 ${Math.round(wait / 1000)} 秒再接着（第 ${i + 1} 次）`)
        await sleep(wait)
        continue
      }
      const wait = Math.min(2 ** i * 500 + Math.floor(Math.random() * 400), 20000)
      console.warn(`  ↻ ${what} 第 ${i + 1} 次没成（${code}），${wait}ms 后重试`)
      await sleep(wait)
    }
  }
  throw last
}

/** 有多少并发跑多少，但不超过上限。保序返回。 */
async function pool(items, worker, limit = CONCURRENCY) {
  const out = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return out
}

/** 现在的 historyId。**回填之前先把它记在手上**——先记后拉，宁可下轮重叠也不能漏。 */
export async function currentHistoryId(gmail) {
  const { data } = await retry(() => gmail.users.getProfile({ userId: 'me' }), 'getProfile')
  return { historyId: String(data.historyId || ''), total: Number(data.messagesTotal || 0) }
}

/**
 * 列出所有 message id。翻页到底，每页 500。
 * onPage 用来报进度——「回填中 3200/18000」那句就是它喂的。
 */
export async function listIds(gmail, { q = '-in:chats', onPage } = {}) {
  const ids = []
  let pageToken
  let page = 0
  do {
    const { data } = await retry(
      () => gmail.users.messages.list({ userId: 'me', q, maxResults: 500, pageToken }),
      'messages.list', gmail)
    for (const m of data.messages || []) ids.push(m.id)
    pageToken = data.nextPageToken
    page++
    onPage?.({ page, got: ids.length, estimate: Number(data.resultSizeEstimate || 0) })
  } while (pageToken)
  return ids
}

/**
 * 批量拿信头。**format=metadata + 指定 metadataHeaders**——不拉正文。
 * 一封信头几百字节，几万封也就几十 MB；正文等你认领了那个地址才拉。
 */
export async function getMetadata(gmail, ids, { onBatch, onGone } = {}) {
  let done = 0
  let gone = 0
  const msgs = await pool(ids, async (id) => {
    let r
    try {
      r = await retry(
        () => gmail.users.messages.get({
          userId: 'me', id, format: 'metadata', metadataHeaders: WANT_HEADERS,
        }),
        `messages.get ${id}`, gmail)
    } catch (err) {
      // **一封拿不到不能拖垮整轮。**
      //
      // 真撞上了：增量里 6 封，其中 1 封你已经在 Gmail 里删了/移走了，
      // messages.get 回 404 —— 结果另外 5 封真信一封都没进来。
      // 那是最坏的失败形态：一封无关紧要的信让六封都不见了。
      //
      // 404 = 这封信现在不存在了，跳过它，接着跑。别的错照旧往上抛。
      if ((err?.response?.status ?? err?.code) === 404) { gone++; return null }
      throw err
    }
    done++
    if (done % 200 === 0) onBatch?.({ done, total: ids.length })
    return r.data
  })
  onBatch?.({ done, total: ids.length, gone })
  if (gone) onGone?.(gone)
  return msgs.filter(Boolean)
}

/** 一封信的正文。只有认领之后才会走到这儿。 */
export async function getFull(gmail, id) {
  const { data } = await retry(
    () => gmail.users.messages.get({ userId: 'me', id, format: 'full' }), `messages.get(full) ${id}`, gmail)
  return data
}

/**
 * 一批 history records → 这轮要去核一遍的 message id。纯函数，gmail.test.js 按着。
 *
 * ══ 为什么是「出现过就收」，不是「只收新来的」 ═══════════════════
 *
 * 原来这儿只收 messagesAdded，而且在请求上就写死 historyTypes:['messageAdded']。
 * 那等于跟 Gmail 说「别的事都别告诉我」。**它漏掉了一整类真信。**
 *
 * 真事（2026-09-11 查出来的）：8/18 到 9/11 发出去 48 封，有 2 封在库里
 * 根本不存在——9/10 给 Stacy＋David 的回信、9/11 回 Biayna 的信。两封都是
 * 在 Gmail 里**先存成草稿、后来才按发送**的。这种信的一生是：
 *
 *   草稿诞生那刻  → messageAdded，但带着 DRAFT 标签，被 classify 丢掉（没发生的事不进账本）
 *   真发出那一刻  → **只有 labelsAdded +SENT**，没有新信事件
 *
 * 于是三道门叠在一起：进不来（草稿被丢）、听不见（发出只翻标签）、补不到
 * （auditPass 只扫账本里已有的行）。信在 Gmail 里好端端躺着，系统里不存在，
 * 卡片上「上次碰」停在对方那封——看起来就像你没回过。
 *
 * 所以判据换成：**这轮 Gmail 说「这封动过」的，全部拿去核一遍标签。**
 * 该不该入账由 classify 一处决定（它本来就是唯一的汇流点），这儿只负责
 * 不要替它先把信扔掉。
 *
 * 裸 record（只有 messages、没有任何 messagesAdded/labelsAdded）也收——
 * 那正是上面那封 9/10 的信在历史里唯一的形状。
 *
 * messagesDeleted 一样收：拿不到会 404，getMetadata 记一笔 gone 跳过，那是
 * 空转；而发草稿时 Gmail 可能同时报一句「草稿没了」，排掉它就等于把刚
 * 堵上的洞又挖开。**多拿一次是浪费，少拿一封是永远看不见。**
 */
export function idsFromHistory(records) {
  const ids = new Set()
  for (const h of records || []) {
    for (const m of h?.messages || []) if (m?.id) ids.add(m.id)
    for (const k of ['messagesAdded', 'messagesDeleted', 'labelsAdded', 'labelsRemoved']) {
      for (const a of h?.[k] || []) if (a?.message?.id) ids.add(a.message.id)
    }
  }
  return [...ids]
}

/**
 * 增量：从 startHistoryId 往后，Gmail 说哪些 message 动过。
 *
 * 返回 { ids, historyId, tooOld }。tooOld = Gmail 说那个游标太老了
 * （它只留几天到几周）——这时候**必须**退回有界重列，不能静默当成没有新信。
 */
export async function historySince(gmail, startHistoryId) {
  const ids = new Set()
  let pageToken
  let latest = startHistoryId
  try {
    do {
      const { data } = await retry(
        // historyTypes 不填 —— 填了就是让 Gmail 替我们先扔一批，见 idsFromHistory。
        () => gmail.users.history.list({
          userId: 'me', startHistoryId, maxResults: 500, pageToken,
        }),
        'history.list', gmail)
      for (const id of idsFromHistory(data.history)) ids.add(id)
      if (data.historyId) latest = String(data.historyId)
      pageToken = data.nextPageToken
    } while (pageToken)
  } catch (err) {
    if ((err?.response?.status ?? err?.code) === 404) {
      return { ids: [], historyId: null, tooOld: true }
    }
    throw err
  }
  return { ids: [...ids], historyId: latest, tooOld: false }
}

/**
 * 正文纯文本。Gmail 的 payload 是棵树，text/plain 可能藏在任意一层，
 * 也可能只有 text/html。都没有就返回空串——**空串比乱码好**，乱码会被
 * 当成内容引用进一封真的信里。
 */
export function plainText(payload) {
  const pick = (node, want) => {
    if (!node) return null
    if (node.mimeType === want && node.body?.data) return decode(node.body.data)
    for (const p of node.parts || []) {
      const got = pick(p, want)
      if (got) return got
    }
    return null
  }
  const txt = pick(payload, 'text/plain')
  if (txt) return txt
  const html = pick(payload, 'text/html')
  return html ? stripHtml(html) : ''
}

const decode = (d) => Buffer.from(String(d).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

const stripHtml = (h) => h
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, '\n\n')
  .trim()
