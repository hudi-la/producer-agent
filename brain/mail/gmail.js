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

/** 退避重试。只重试「再试一次可能就好」的那几种，别的直接抛。 */
async function retry(fn, what) {
  let last
  for (let i = 0; i < MAX_TRIES; i++) {
    try {
      return await fn()
    } catch (err) {
      const authed = asAuthErrorIfItIs(err)
      if (authed.name === 'MailAuthError') throw authed        // 授权掉了，重试也没用
      const code = err?.response?.status ?? err?.code
      const retryable = code === 429 || code === 403 || (code >= 500 && code < 600)
        || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
      if (!retryable) throw err
      last = err
      const wait = Math.min(2 ** i * 500 + Math.floor(Math.random() * 400), 20000)
      console.warn(`  ↻ ${what} 第 ${i + 1} 次没成（${code}），${wait}ms 后重试`)
      await new Promise((r) => setTimeout(r, wait))
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
      'messages.list')
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
export async function getMetadata(gmail, ids, { onBatch } = {}) {
  let done = 0
  const msgs = await pool(ids, async (id) => {
    const r = await retry(
      () => gmail.users.messages.get({
        userId: 'me', id, format: 'metadata', metadataHeaders: WANT_HEADERS,
      }),
      `messages.get ${id}`)
    done++
    if (done % 200 === 0) onBatch?.({ done, total: ids.length })
    return r.data
  })
  onBatch?.({ done, total: ids.length })
  return msgs
}

/** 一封信的正文。只有认领之后才会走到这儿。 */
export async function getFull(gmail, id) {
  const { data } = await retry(
    () => gmail.users.messages.get({ userId: 'me', id, format: 'full' }), `messages.get(full) ${id}`)
  return data
}

/**
 * 增量：从 startHistoryId 往后有哪些新 message。
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
        () => gmail.users.history.list({
          userId: 'me', startHistoryId, historyTypes: ['messageAdded'],
          maxResults: 500, pageToken,
        }),
        'history.list')
      for (const h of data.history || []) {
        for (const a of h.messagesAdded || []) if (a.message?.id) ids.add(a.message.id)
      }
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
