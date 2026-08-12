// 给一条线配班底：这条线是在跟谁打交道。
//
// ══ 为什么需要它 ═══════════════════════════════════════════════
//
// Brooke 今天回了信，人际管理那边好好的，「合作开课 · LA County Arboretum」
// 那条线上却是 0 封。因为信按地址归到了人身上，而线跟人之间没有关系这一层。
//
// 0052 建了 pursuit_parties。这个文件负责把它填上。
//
// ══ 只从线这边出发 ═════════════════════════════════════════════
//
// **不做的事**：拿 546 封历史信去反推「它该属于哪条线」。那会把一堆早就
// 不跑了的旧项目翻出来，而你现在没在搞那些。
//
// **做的事**：对每一条你还在跑的线，问「跟它打交道的是通讯录里的谁」。
// 匹配不上的线就空着——空着是对的，那些提案本来就还没发出去。

import { db } from './store.js'
import { ask } from './ask.js'

const rpc = async (fn, args) => {
  const { data, error } = await db().rpc(fn, args)
  if (error) throw new Error(`${fn} 失败：${error.message}`)
  return data
}

// 还没发出去的提案不该有信，别去为难它们；已经放弃的更不用。
const LIVE = ['sent', 'replying', 'won', 'matching', 'writing', 'paused']

export async function castPass({ apply = true, stages = LIVE, log = console.log } = {}) {
  const { data: pursuits, error: e1 } = await db()
    .from('v_pa_pursuits').select('id, title, org, stage').in('stage', stages)
  if (e1) throw new Error(e1.message)

  const { data: parties, error: e2 } = await db()
    .from('v_pa_verdict_archive').select('email, verdict, name, org, why, n, n_out, last_at, subject')
  if (e2) throw new Error(e2.message)

  // 只拿**已经认过**的（进了通讯录或机构信箱）。没认过的还在「等你点头」，
  // 那一步没走完就往线上挂，等于替你做了两个决定。
  const { data: known } = await db().from('v_pa_contacts').select('id, name, org, role')
  const { data: emails } = await db().from('v_pa_contact_emails').select('contact_id, email')
  const { data: boxes } = await db().from('v_pa_org_mailboxes').select('email, org, label')

  const byContact = new Map()
  for (const c of known || []) byContact.set(c.id, { ...c, emails: [] })
  for (const e of emails || []) byContact.get(e.contact_id)?.emails.push(e.email)

  const need = (pursuits || []).filter((p) => true)
  if (!need.length) return { note: '没有要配班底的线' }

  log(`${need.length} 条线 × （${byContact.size} 个人 + ${(boxes || []).length} 个机构信箱），问一次…`)

  const text = await ask(`把「机会线」和「已经认识的人/机构信箱」对上。

【机会线】
${need.map((p) => `- [${p.id.slice(0, 8)}] ${p.title}｜机构：${p.org || '（没写）'}｜阶段：${p.stage}`).join('\n')}

【通讯录里的人】
${[...byContact.values()].map((c) =>
  `- ${c.name}｜${c.emails.join('、')}${c.org ? `｜${c.org}` : ''}${c.role ? `｜${c.role}` : ''}`).join('\n')}

【机构共享信箱】
${(boxes || []).map((b) => `- ${b.email}｜${b.org}`).join('\n')}

规则：
· 判据是**同一个机构**——线上的机构名跟这个人/信箱的机构或邮箱域名对得上。
  例：线「工作坊提案 · The Huntington」↔ 域名 huntington.org 的人
· 一条线可以有好几个人（对接人 + 机构公用信箱都算）
· 一个人也可以在好几条线上
· **对不上就别列**。宁可一条线空着，也不要把不相干的人挂上去——
  挂错了那条线的往来就全是别人的事，比空着糟得多。
· 拿不准（只是名字听着像、领域相近）→ confidence 给 low

**最后一行**单独输出，别的什么都不要加：
[[CAST]] {"cast":[{"pursuit":"上面那个 8 位短号","who":"人名或机构信箱地址，原样抄","why":"凭什么认定","confidence":"high|low"}]}
一个都对不上就输出 [[CAST]] {"cast":[]}`)

  const m = text.match(/\[\[CAST\]\]\s*(\{[\s\S]*\})\s*$/)
  if (!m) return { note: '它没按格式回话，这轮不动任何东西', raw: text.slice(-300) }
  let list = []
  try { list = JSON.parse(m[1]).cast || [] } catch (_) { list = [] }

  const shortId = new Map(need.map((p) => [p.id.slice(0, 8), p]))
  const byName = new Map([...byContact.values()].map((c) => [String(c.name || '').trim(), c.id]))
  const boxSet = new Set((boxes || []).map((b) => String(b.email).toLowerCase()))

  const high = [], low = [], lost = []
  for (const x of list) {
    const p = shortId.get(String(x?.pursuit || '').trim())
    const who = String(x?.who || '').trim()
    const cid = byName.get(who)
    const box = boxSet.has(who.toLowerCase()) ? who.toLowerCase() : null
    if (!p || (!cid && !box)) { lost.push(x); continue }
    const row = { pursuit_id: p.id, title: p.title, who, contact_id: cid || null, mailbox: box, why: x.why }
    ;(x.confidence === 'high' ? high : low).push(row)
  }
  log(`  高把握 ${high.length}｜没把握 ${low.length}${lost.length ? `｜对不上 ${lost.length}` : ''}`)

  const attached = []
  if (apply) {
    for (const h of high) {
      try {
        await rpc('pa_attach_party', {
          p_pursuit_id: h.pursuit_id, p_contact_id: h.contact_id,
          p_mailbox: h.mailbox, p_note: h.why, p_by: 'fairwind',
        })
        attached.push(h)
        log(`  ✓ ${h.title} ← ${h.who}`)
      } catch (err) { log(`  ✗ ${h.title} ← ${h.who}：${err.message}`) }
    }
  }
  return { lines: need.length, high: high.length, low, attached, lost, applied: apply }
}
