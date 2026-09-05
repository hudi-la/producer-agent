// 抄送栏里的人、同机构回信的人：自己进通讯录、挂上线。**不过模型。**
//
// ══ 为什么需要它 ═══════════════════════════════════════════════
//
// 你给机构发信，机构回信时抄送了同事 B，或者转给 B、B 从自己的地址回你。
// 这个 B 在系统里不存在——To/Cc 从第一天就存着，但整条管线只看
// counterpart_email，一个只出现在抄送栏里的人永远轮不到被判。
//
// 真事（2026-09-04）：Brooke 8/11 回信抄送了 Rachel，之后你回的四封都带着
// 她，系统连她叫什么都不知道；Lorna 两次抄送 Meighan，Meighan 9/4 自己回了
// 信——她的休假自动回复早被判成「群发」，这封真回信卡在账本里。
//
// ══ 规则 ═══════════════════════════════════════════════════════
//
//   在某条线的信串里出现的地址，跟这条线上已有的人**同一个机构**（域名相同）、
//   署名像个人 → 就是这条线的人。建名片、认领地址、挂上线、搬他的信。
//
// 不同机构的抄送、看着像共享信箱的（info@ / programs@）、没署名的 → 不自动
// 建，写一条判定进「新联系人」面板，理由写清是谁在哪条线抄送的。**没署名不编
// 名字**——编一个看起来合理的名字比说不知道更坏。
//
// 来路三处都写：名片 notes（界面「关系记忆」）、名片 meta.source、
// 线上那一行的 note（卡片「相关的人」下面一行小字）。

import { db, putVerdict } from './store.js'
import { gmailFor, getMetadata } from './gmail.js'
import { client as authClient } from './auth.js'
import { headerMap, parseAddr, parseAddrList, namesOf } from './addr.js'
import { carryPass } from './carry.js'

const rpc = async (fn, args) => {
  const { data, error } = await db().rpc(fn, args)
  if (error) throw new Error(`${fn} 失败：${error.message}`)
  return data
}

// 本地部分一看就是一个组、不是一个人。宁可多放几个进「新联系人」面板，
// 也不要把 programs@ 建成一张名片——那是 0033 犯过的错。
const GENERIC_LOCAL =
  /^(info|office|programs?|admin|hello|hi|contact|contacts|mail|team|staff|events?|workshops?|residency|residencies|education|press|marketing|support|sales|hr|jobs|careers|general|inquir(?:y|ies)|enquir(?:y|ies)|reception|frontdesk|gallery|studio|shop|store|bookings?|registrar|tickets?|newsletter|news|media|outreach|community|volunteers?|membership|development|grants?|applications?|apply|submissions?|submit|curatorial|exhibitions?|library|archives?|visitorcenter|welcome|questions|help|services?)$/i

/**
 * 这个地址看着是人、是共享信箱、还是看不出来。纯函数。
 *   person   有署名，署名像人名
 *   mailbox  本地部分是 info@ 这种；或署名就是机构名 / 全大写缩写（IPM）
 *   unsure   没署名 —— 不编
 */
export function looksLike({ email, name, org }) {
  const local = String(email || '').split('@')[0].toLowerCase()
  if (GENERIC_LOCAL.test(local)) return 'mailbox'
  const n = String(name || '').trim()
  if (!n || n.includes('@')) return 'unsure'
  const o = String(org || '').trim().toLowerCase()
  if (o && n.toLowerCase() === o) return 'mailbox'
  if (!/[a-z]/.test(n) && /^[A-Z0-9&.\- ]{2,8}$/.test(n)) return 'mailbox'
  return 'person'
}

const md = (t) => {
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * 来路那一句。纯函数。
 *   base   谁、什么时候、在哪条线、怎么带进来的
 *   note   写进名片（带「自动收进」的标记）
 *   party  写进线上那一行（短）
 */
export function provenance(r) {
  const d = md(r.sent_at)
  const line = `「${r.pursuit_title}」`
  const via = r.via_name || r.via_email || ''
  let base, party
  if (r.kind === 'reply') {
    base = `${d} 在${line}那条线的信串里回了信，跟线上的人同一个机构`
    party = `${d} 在这条线的信串里回信，同机构`
  } else {
    const verb = r.kind === 'to' ? '也发给了' : '抄送了'
    if (r.via_direction === 'out') {
      base = `你 ${d} 在${line}写给 ${via} 时${verb}这个地址`
      party = `你 ${d} 写给 ${via} 时${verb}`
    } else {
      base = `${via} ${d} 在${line}回信时${verb}这个地址`
      party = `${via} ${d} 回信时${verb}`
    }
  }
  return { base, note: `${base}（自动收进通讯录，0121）`, party }
}

/**
 * 每一条候选该走哪条路。纯函数，好测。
 *   adopt  同机构 + 署名像人 → 自动建人挂线
 *   greet  其余 → 写一条判定进「新联系人」面板（person 或 shared_box）
 *   skip   外机构、早有判定的（它自己的信早判过了，别重判）
 */
export function decide(r) {
  const shape = looksLike({ email: r.email, name: r.name, org: r.org_guess })
  if (r.same_org && shape === 'person') return { act: 'adopt' }
  if (!r.same_org && r.verdict) return { act: 'skip', why: '外机构地址，早有判定' }
  if (shape === 'mailbox') return { act: 'greet', verdict: 'shared_box' }
  return { act: 'greet', verdict: 'person', unsure: shape === 'unsure' }
}

/** 一封 Gmail metadata → { 地址: 署名 }。 */
export function namesFromMessage(m) {
  const h = headerMap(m?.payload?.headers)
  return namesOf([parseAddr(h['from']), ...parseAddrList(h['to']), ...parseAddrList(h['cc'])])
}

/** 几封信的署名：去 Gmail 拿一次信头。→ Map(message id → { 地址: 署名 }) */
export async function fetchNames(ids) {
  if (!ids.length) return new Map()
  const gmail = gmailFor(await authClient())
  const msgs = await getMetadata(gmail, ids, {})
  return new Map(msgs.map((m) => [m.id, namesFromMessage(m)]))
}

/** 写回库里。rows: [{gmail_message_id, names}]。写过的 names 至少是 {}，不再是 null。 */
export const writeNames = (rows) => rows.length ? rpc('pa_mail_names_fill', { p_rows: rows }) : 0

/**
 * 老信没存署名的，去 Gmail 拿一次信头补上，写回库里。
 * 看过但没署名的记成 ""，下轮别再去拿。
 */
async function fillNames(rows, { log }) {
  const need = [...new Set(rows.filter((r) => !r.name_checked).map((r) => r.gmail_message_id))]
  if (!need.length) return 0
  const got = await fetchNames(need)
  const fill = []
  for (const id of need) {
    const names = { ...(got.get(id) || {}) }
    for (const r of rows) {
      if (r.gmail_message_id !== id) continue
      if (!(r.email in names)) names[r.email] = ''
      r.name = names[r.email] || null
      r.name_checked = true
    }
    fill.push({ gmail_message_id: id, names })
  }
  await writeNames(fill)
  log(`  ↳ 补署名：${need.length} 封`)
  return need.length
}

export async function copiedPass({ apply = true, log = console.log } = {}) {
  const rows = (await rpc('pa_copied_strangers')) || []
  if (!rows.length) return { checked: 0, adopted: [], greeted: [], skipped: [], carried: 0 }

  try { await fillNames(rows, { log }) }
  catch (err) { log(`  ⚠️ 补署名没成（${err.message}），没署名的这轮先不动`) }

  const adopted = [], greeted = [], skipped = []
  for (const r of rows) {
    const d = decide(r)
    const p = provenance(r)
    if (d.act === 'adopt') {
      if (!apply) { adopted.push({ email: r.email, name: r.name, title: r.pursuit_title, dry: true }); continue }
      try {
        const out = await rpc('pa_adopt_copied', {
          p_email: r.email, p_name: r.name, p_org: r.org_guess, p_pursuit_id: r.pursuit_id,
          p_note: p.note, p_party_note: p.party,
          p_meta: {
            kind: r.kind, via_email: r.via_email, via_contact_id: r.via_contact_id,
            pursuit_id: r.pursuit_id, gmail_message_id: r.gmail_message_id, at: r.sent_at,
          },
        })
        adopted.push({ email: r.email, name: r.name, title: r.pursuit_title,
                       created: out?.created, moved: out?.moved, other_lines: out?.other_lines })
        log(`  ✓ ${r.name}（${r.email}）→ ${r.pursuit_title}：${p.party}`)
      } catch (err) {
        skipped.push({ email: r.email, why: err.message })
        log(`  ✗ ${r.email}：${err.message}`)
      }
    } else if (d.act === 'greet') {
      // 已经以同样的判定躺在「等你点头」里了，别每轮重写一遍
      if (r.verdict === d.verdict && r.business) { skipped.push({ email: r.email, why: '已在等你点头' }); continue }
      if (r.decided_by === 'you') { skipped.push({ email: r.email, why: '你定过的' }); continue }
      if (!r.name_checked) { skipped.push({ email: r.email, why: '署名还没补' }); continue }
      const why = p.base + (d.unsure ? '。信头上没有署名，看不出是人还是共享信箱' : '') + '，还没进通讯录'
      if (!apply) { greeted.push({ email: r.email, verdict: d.verdict, why, dry: true }); continue }
      try {
        await putVerdict({ email: r.email, verdict: d.verdict, business: true, why,
                           name: r.name, org: r.org_guess, decided_by: 'rule' })
        greeted.push({ email: r.email, verdict: d.verdict, why })
        log(`  · ${r.email} → 等你点头（${d.verdict}）：${p.base}`)
      } catch (err) { skipped.push({ email: r.email, why: err.message }) }
    } else {
      skipped.push({ email: r.email, why: d.why })
    }
  }

  // 他自己发过的信（Meighan 9/4 那封）现在有主了，搬进对话表
  let carried = 0
  const emails = [...new Set(adopted.filter((a) => !a.dry).map((a) => a.email))]
  if (emails.length) {
    const c = await carryPass({ touched: emails, log })
    carried = c.added || 0
  }
  return { checked: rows.length, adopted, greeted, skipped, carried }
}
