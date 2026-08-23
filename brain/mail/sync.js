// 进货：把 Gmail 里的信头搬进库。**全程不过模型。**
//
// 两条路，同一条管线：
//   · backfill()   第一次，把整个信箱的信头抓一遍
//   · incremental() 之后每次，只拉 historyId 之后新增的
//
// 三条实现上的规矩，都是从「漏掉的信在界面上长得跟没有一样」这条教训来的：
//   · 回填**先记 historyId 再拉信**。宁可下一轮重叠着多拉一点（反正
//     on conflict do nothing），也不能在「拉完」和「记游标」之间漏掉新到的信。
//   · history.list 说游标太老（404）就退回有界重列，**不静默当成没有新信**。
//   · 每一步都报数，包括 0。

import { gmailFor, currentHistoryId, listIds, getMetadata, historySince } from './gmail.js'
import { classify, mineSet } from './addr.js'
import { db, myAccounts, putHeaders, setCursor } from './store.js'
import { client as authClient, whoami } from './auth.js'

const BATCH = 500          // 一次往库里塞多少行

/**
 * 授权的那个 Gmail 账号，必须就是库里登记的那个。
 *
 * 这条护栏很要紧：如果你授权的是另一个 Google 账号，那么「哪一方是我」
 * 就全判反了——每一封信的 counterpart 都会错，而且错得很安静。
 * 与其事后从三千行里找出来，不如开工前一秒钟拦住。
 */
async function accountFor(me, accounts) {
  const hit = accounts.find((a) => a.address === me.address)
  if (hit) return hit
  throw new Error(
    `授权的是 ${me.address}，但库里登记的信箱是 ${accounts.map((a) => a.address).join('、') || '（一个都没有）'}。\n` +
    `  要么换个账号授权（删掉 brain/.mail-tokens.json 重跑 mail:auth），\n` +
    `  要么把这个地址登记进去（pa_mail_account_upsert）。\n` +
    `  不能就这么跑——「哪一方是我」会全判反，而且错得很安静。`)
}

/** 一批 Gmail message → 一批 mail_headers 行。认不出的整封丢掉并计数。 */
function toRows(msgs, accountId, mine) {
  const rows = []
  let dropped = 0
  for (const m of msgs) {
    const r = m && classify(m, mine)
    if (!r) { dropped++; continue }
    rows.push({ ...r, account_id: accountId })
  }
  return { rows, dropped }
}

async function flush(rows, log) {
  let written = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const r = await putHeaders(chunk)
    written += Number(r?.written || 0)
    log?.(`  写库 ${Math.min(i + BATCH, rows.length)}/${rows.length}（新增 ${written}）`)
  }
  return written
}

/**
 * 补核：时间已过、还没核过标签的信（主要是预约发送 —— 入队时触发过
 * messageAdded，真发出那刻只是标签翻成 SENT，增量听不见）。
 * 去 Gmail 拿一次标签，putHeaders 顺手写审计（0087）。发出去的信
 * 重新过 classify 会正常入行；被取消删掉的信 messages.get 回 404，
 * getMetadata 记成 gone，跳过 —— 它的审计由 0082 的全量核对兜。
 */
export async function auditPass({ log = console.log } = {}) {
  const { data: ids, error } = await db().rpc('pa_unaudited_sent')
  if (error) throw new Error('读补核队列失败：' + error.message)
  const list = (ids || []).map((r) => r.gmail_message_id).filter(Boolean)
  if (!list.length) return { audited: 0 }

  const accounts = await myAccounts()
  const mine = mineSet(accounts.map((a) => a.address))
  const gmail = gmailFor(await authClient())
  let gone = 0
  const msgs = await getMetadata(gmail, list, { onGone: (n) => { gone = n } })
  const { rows } = toRows(msgs, accounts[0].id, mine)
  if (rows.length) await putHeaders(rows)
  log(`  ↳ 补核标签：${rows.length} 封写了审计${gone ? `，${gone} 封 Gmail 里已没有` : ''}`)
  return { audited: rows.length, gone }
}

/**
 * 第一次：整个信箱的信头。
 *
 * q 默认排掉 Hangouts/Chat 记录（`-in:chats`）——那不是邮件，混进来只会
 * 让「还不认识的地址」多出一堆聊天对象。
 */
export async function backfill({ q = '-in:chats', log = console.log } = {}) {
  const auth = await authClient()
  const gmail = gmailFor(auth)
  const me = await whoami()
  const accounts = await myAccounts()
  const acct = await accountFor(me, accounts)
  const mine = mineSet(accounts.map((a) => a.address))

  // **先记游标，再拉信。** 顺序反了的话，回填期间新到的信会永远漏掉：
  // 它既不在你拉到的那批里，也不在「之后的增量」里。
  const { historyId } = await currentHistoryId(gmail)
  log(`回填 ${me.address}：信箱里 ${me.total} 封，游标先记在 ${historyId}`)

  const ids = await listIds(gmail, {
    q,
    onPage: ({ page, got }) => log(`  列清单 第 ${page} 页，累计 ${got} 封`),
  })
  log(`  清单齐了：${ids.length} 封`)

  const msgs = await getMetadata(gmail, ids, {
    onBatch: ({ done, total }) => log(`  拉信头 ${done}/${total}`),
    onGone: (n) => log(`  ↳ ${n} 封在 Gmail 里已经不存在了（删了或移走了），跳过`),
  })

  const { rows, dropped } = toRows(msgs, acct.id, mine)
  if (dropped) log(`  ⚠️ ${dropped} 封认不出发件人或时间，没入库（宁可少一封，不要假数据）`)

  const written = await flush(rows, log)
  await setCursor(acct.id, historyId, true)

  log(`回填完：拉到 ${ids.length} 封，入库 ${rows.length} 行，其中新增 ${written}`)
  return { account: me.address, listed: ids.length, parsed: rows.length, dropped, written, historyId }
}

/**
 * 之后每次：只拉 historyId 之后新增的。
 *
 * 游标太老（Gmail 只留几天到几周）→ 退回按时间有界重列。
 * **不能静默返回 0**：那正是这次事故里最伤人的失败形态。
 */
export async function incremental({ fallbackWindow = '30d', log = console.log } = {}) {
  const auth = await authClient()
  const gmail = gmailFor(auth)
  const me = await whoami()
  const accounts = await myAccounts()
  const acct = await accountFor(me, accounts)
  const mine = mineSet(accounts.map((a) => a.address))

  if (!acct.backfilled_at) {
    return { skipped: true, note: '还没全量回填过，先跑一次 backfill' }
  }

  if (!acct.history_id) {
    return { skipped: true, note: '没有游标（history_id 是空的），先跑一次 backfill' }
  }

  let ids = []
  let historyId = acct.history_id
  let rebuilt = false

  const h = await historySince(gmail, acct.history_id)
  if (h.tooOld) {
    // Gmail 把那个游标丢了。**说出来**，然后按时间窗重列兜底。
    rebuilt = true
    log(`  ⚠️ 游标 ${acct.history_id} 已经太老，Gmail 不认了。退回按时间重列最近 ${fallbackWindow}`)
    ids = await listIds(gmail, { q: `-in:chats newer_than:${fallbackWindow}` })
    historyId = (await currentHistoryId(gmail)).historyId
  } else {
    ids = h.ids
    historyId = h.historyId || acct.history_id
  }

  if (!ids.length) {
    await setCursor(acct.id, historyId)
    log('  没有新信。')
    return { added: 0, listed: 0, rebuilt, historyId, touched: [], note: '没有新信' }
  }

  const msgs = await getMetadata(gmail, ids, {
    onGone: (n) => log(`  ↳ ${n} 封在 Gmail 里已经不存在了，跳过`),
  })
  const { rows, dropped } = toRows(msgs, acct.id, mine)
  const written = await flush(rows, log)
  await setCursor(acct.id, historyId)

  // 这一轮碰到了哪些对方地址。下一步（搬进对话表）只看这些，不用全扫。
  // 报的是 rows 而不是「真正新增的那几行」——putHeaders 只回总数，分不出
  // 是哪几行。宁可多报几个：多搬一次是空转（账本里没有待搬的就立刻返回），
  // 少报一个是那封信从此看不见。
  const touched = [...new Set(rows.map((r) => r.counterpart_email).filter(Boolean))]

  log(`  收到 ${ids.length} 封，入库 ${rows.length} 行，其中新增 ${written}`)
  return { added: written, listed: ids.length, parsed: rows.length, dropped, rebuilt, historyId, touched }
}
