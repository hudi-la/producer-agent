// 按 message id 把几封信重新拉进账本。`npm run mail:refetch <id> [id...]`
//
// ══ 为什么需要一个「按 id 重来一遍」的口子 ═══════════════════════
//
// 增量同步靠游标往前走，**它从不回头**。所以一封信一旦在它那一轮被漏掉，
// 就永远不会被第二次看见 —— 界面上「他没回」和「系统没收到」长得一模一样。
//
// 真事（2026-09-11）：8/18 以来发出去 48 封，有 2 封库里根本没有 ——
// 9/10 给 Stacy＋David 的回信、9/11 回 Biayna 的信。两封都是在 Gmail 里
// 先存草稿、后来才发的：草稿那刻被 classify 丢掉（没发生的事不进账本），
// 发出那刻增量只听 messageAdded 听不见。洞已经堵在 gmail.js 的
// idsFromHistory 里，但**游标早推过去了，堵上洞不会把旧的捞回来**。
//
// 这就是这个文件。它不猜、不重排、不动游标：给它 id，它去 Gmail 拿一次
// 信头，走**同一个** classify，写进账本，再把该搬的搬进对话表。
//
// 判定逻辑一行都没有复制过来 —— 复制一份就等于以后两处会不一样。

import { gmailFor, getMetadata } from './gmail.js'
import { client as authClient } from './auth.js'
import { classify, mineSet } from './addr.js'
import { myAccounts, putHeaders, db } from './store.js'
import { carryPass } from './carry.js'

/**
 * 拉这几封信进账本。
 * 返回 { wrote, rows, gone, dropped } —— dropped 是「拿到了但 classify 不收」，
 * 那是正常结论（草稿、还没发出去的），**但必须说出来**，不能看起来像成功。
 */
export async function refetch(ids, { log = console.log } = {}) {
  if (!ids?.length) return { wrote: 0, rows: [], gone: [], dropped: [] }

  const accounts = await myAccounts()
  if (!accounts?.length) throw new Error('库里一个邮箱账号都没有，先跑 mail:auth')
  const mine = mineSet(accounts.map((a) => a.address))
  const gmail = gmailFor(await authClient())

  const msgs = await getMetadata(gmail, ids, {})
  const got = new Set(msgs.map((m) => m.id))
  const gone = ids.filter((id) => !got.has(id))

  const rows = []
  const dropped = []
  for (const m of msgs) {
    const r = classify(m, mine)
    if (!r) { dropped.push({ id: m.id, labels: m.labelIds || [] }); continue }
    rows.push({ ...r, account_id: accounts[0].id })
  }

  const wrote = rows.length ? Number((await putHeaders(rows))?.written || 0) : 0
  for (const r of rows) {
    log(`  ✓ ${r.sent_at.slice(0, 10)} ${r.direction === 'out' ? '你 →' : '→ 你'} ${r.counterpart_email}｜${r.subject || '（无主题）'}`)
  }
  for (const d of dropped) log(`  · ${d.id}：classify 不收（标签 ${d.labels.join(',') || '无'}）—— 多半还没发出去`)
  for (const id of gone) log(`  ✗ ${id}：Gmail 里没有这封`)
  log(`账本：${rows.length} 行，其中新增 ${wrote}`)

  return { wrote, rows, gone, dropped }
}

/** 把刚补进来的信搬进对话表 + 认亲。不做这步，信在账本里但卡片上还是看不见。 */
export async function settle(rows, { log = console.log } = {}) {
  const emails = [...new Set(rows.map((r) => r.counterpart_email).filter(Boolean))]
  const carried = emails.length ? (await carryPass({ touched: emails, log })).added || 0 : 0
  const { data, error } = await db().rpc('pa_link_replies')
  if (error) throw new Error('认亲失败：' + error.message)
  log(`进对话表 ${carried} 条｜认亲 ${Number(data?.linked || 0)} 条`)
  return { carried, linked: Number(data?.linked || 0) }
}
