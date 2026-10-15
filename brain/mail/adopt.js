// 点头入库：你认了一个地址，它名下的信才从账本搬进对话表。
//
// 这是「正文按需拉」的那条边界。回填只抓信头（便宜、机械、全量），
// 正文一直不碰——直到你说「这个人算数」。那一刻才去 Gmail 拉他那几封的
// 正文、才让模型写摘要、才走 pa_add_mail 进 pursuit_messages。
//
// 为什么归属这一步一行代码都不用写：pa_add_mail 判断一封信是谁的，
// 完全按 counterpart_email 查 contact_emails / org_mailboxes。所以只要
// 先 pa_claim_email（或 pa_mark_org_mailbox），后面每一封自己就归位了。
// 这一刀从头到尾没碰归属层，只是终于有信喂给它了。

import { gmailFor, getFull, plainText } from './gmail.js'
import { client as authClient } from './auth.js'
import { db, toPromote, markPromoted } from './store.js'
import { ask } from './ask.js'

const SUM_BATCH = 8        // 一次让模型摘几封
const BODY_CAP = 2000      // 喂给摘要的正文截到多少字

const rpc = async (fn, args) => {
  const { data, error } = await db().rpc(fn, args)
  if (error) throw new Error(`${fn} 失败：${error.message}`)
  return data
}

/**
 * 一批信 → 一批一句话中文摘要。
 *
 * 摘要失败不致命：pa_add_mail 的 p_content 退回正文首段。**先落原文，
 * 后写摘要**是 0027 就立下的顺序——摘要挂了行还在，界面显示原文首段；
 * 反过来做的话，模型一挂那封信就永远不存在。
 */
async function summarize(items) {
  const out = new Map()
  for (let i = 0; i < items.length; i += SUM_BATCH) {
    const batch = items.slice(i, i + SUM_BATCH)
    const body = batch.map((m, k) => [
      `### ${k + 1}｜${m.direction === 'out' ? '你发出' : '他发来'}｜${String(m.sent_at).slice(0, 10)}`,
      `主题：${m.subject || '（无主题）'}`,
      (m.raw || '').slice(0, BODY_CAP) || '（正文是空的）',
    ].join('\n')).join('\n\n---\n\n')

    let text
    try {
      text = await ask(`下面 ${batch.length} 封信，每封写一句中文摘要：这封信**要什么或给了什么**。
一句话，别复述主题行，别写"他说……"这种废话。

${body}

**最后一行**单独输出，别的什么都不要加：
[[SUM]] {"s":["第1封的摘要","第2封的摘要", …]}
一共 ${batch.length} 条，顺序对上，一条都不能少。`)
    } catch (_) {
      continue   // 这一批没摘成，它们退回正文首段
    }

    const m = text.match(/\[\[SUM\]\]\s*(\{[\s\S]*\})\s*$/)
    let list = []
    try { list = m ? (JSON.parse(m[1]).s || []) : [] } catch (_) { list = [] }
    batch.forEach((it, k) => { if (list[k]) out.set(it.gmail_message_id, String(list[k]).trim()) })
  }
  return out
}

/**
 * 把一个地址名下还没搬过的信，全部搬进对话表。
 * 认领动作（建人 / 登记机构信箱）由调用方先做完——这儿只管搬。
 */
export async function promote(email, { log = console.log } = {}) {
  const rows = await toPromote(email)
  if (!rows.length) return { email, promoted: 0, note: '没有待搬的信' }

  log(`  ${email}：${rows.length} 封要搬，去拉正文…`)
  const gmail = gmailFor(await authClient())

  const items = []
  for (const r of rows) {
    try {
      const full = await getFull(gmail, r.gmail_message_id)
      items.push({ ...r, raw: plainText(full.payload) })
    } catch (err) {
      log(`    ⚠️ ${r.gmail_message_id} 正文拉不到（${err.message}），先只落信头`)
      items.push({ ...r, raw: null })
    }
  }

  log(`  写摘要…`)
  const sums = await summarize(items)

  let added = 0
  const done = []
  const failed = []
  for (const m of items) {
    const summary = sums.get(m.gmail_message_id)
    const { data, error } = await db().rpc('pa_add_mail', {
      p_gmail_message_id: m.gmail_message_id,
      p_counterpart: m.counterpart_email,
      p_role: m.direction === 'out' ? 'artist' : 'org',
      // 摘要没写成就退回正文首段。**永远不要空着**——空着的那一行在界面上
      // 就是一条看不出内容的信，跟丢了差不多。
      p_content: summary || (m.raw || '').trim().slice(0, 200) || `（${m.subject || '无主题'}）`,
      p_pursuit_id: null,
      p_body_raw: m.raw || null,
      p_meta: { subject: m.subject || null, from_name: m.from_name || null },
      p_created_at: m.sent_at || null,
    })
    if (error) { failed.push(m.gmail_message_id); log(`    ⚠️ 一封没写进去：${error.message}`); continue }
    if (data?.inserted) added++
    done.push(m.gmail_message_id)
  }

  await markPromoted(done)
  if (failed.length) {
    const error = new Error(`${failed.length} email(s) could not be archived`)
    error.failedCount = failed.length
    throw error
  }
  const threads = [...new Set(rows.map((r) => r.gmail_thread_id).filter(Boolean))]
  return { email, promoted: done.length, added, threads }
}

/** 认一个人：建/找联系人 → 认领地址（历史往来当场归位）→ 搬信 → 认领 thread。 */
export async function adoptPerson(email, opts = {}) {
  const { contactId, name, org, role, notes, log = console.log } = opts
  let cid = contactId

  if (!cid) {
    const c = await rpc('pa_upsert_contact', {
      p_name: name || email, p_email: email, p_org: org || null,
      p_role: role || null, p_notes: notes || null,
    })
    cid = c?.id || c
    log(`  建了联系人：${name || email}（${cid}）`)
  }

  // 认领地址：这个地址名下**所有历史往来当场归位**，不是从今天开始记
  const claimed = await rpc('pa_claim_email', { p_email: email, p_contact_id: cid, p_note: notes || null })
  log(`  认领地址：库里已有的 ${claimed?.moved ?? 0} 条往来当场归到他名下`)

  const out = await promote(email, { log })

  for (const t of out.threads || []) {
    try { await rpc('pa_claim_contact_thread', { p_contact_id: cid, p_thread_id: t }) } catch (_) {}
  }
  return { ...out, contact_id: cid, moved: claimed?.moved ?? 0 }
}

/** 认一个机构共享信箱：它不是人，往来不归任何人，只登记成机构的。 */
export async function adoptOrgMailbox(email, opts = {}) {
  const { org, label, notes, log = console.log } = opts
  if (!org) throw new Error('机构信箱得有个机构名')
  await rpc('pa_mark_org_mailbox', { p_email: email, p_org: org, p_label: label || null, p_notes: notes || null })
  log(`  登记成机构信箱：${org}`)
  const out = await promote(email, { log })
  return { ...out, org }
}
