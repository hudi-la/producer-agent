import { supa, DB_CONFIGURED, FELL_BACK } from './backends.js'

// 人这一层的读面。
//
// 设计稿：docs/specs/2026-08-08-people-layer-design.md
//
// 跟 loadPursuits 一个姿势：连不上 / 库是空的，都退回一个**说得清原因**的空结果，
// 而不是无声地显示「没有人」——空页可以，骗人不行。
//
// 这儿一次把往来全拉回来（不像首页那样只读一个布尔）。理由是人少：
// 这一刀不做扫老邮箱导通讯录，库里十来个人。等几千个人进来，这儿要改成按需拉——
// 到时候会疼，但现在为它加复杂度是白加。

const empty = (reason, detail) => ({
  contacts: [], orgs: [], msgsByContact: {}, source: 'empty', reason, detail,
})

export async function loadContacts() {
  if (!DB_CONFIGURED) return empty(FELL_BACK.NO_CONFIG)
  try {
    const { data: contacts, error: ce } = await supa
      .from('v_pa_contacts').select('*')
      .order('last_touch_at', { ascending: false, nullsFirst: false })
    if (ce) return empty(FELL_BACK.QUERY_FAILED, ce.message)
    if (!contacts?.length) return empty(FELL_BACK.EMPTY)

    // 他挂在哪几条机会线上 —— 这是「人是独立一层、两区共用同一张名片」
    // 落地之后你**看得见**的样子。Kirk 挂着三条线，名片上就该是三条。
    const { data: pursuits } = await supa
      .from('v_pa_pursuits').select('id,title,stage,contact_id')
    const lines = {}
    for (const p of pursuits || []) {
      if (!p.contact_id) continue
      ;(lines[p.contact_id] ||= []).push({ id: p.id, title: p.title, stage: p.stage })
    }

    // 多个邮箱 + 多个机构，各带起止日期。
    // 停用的地址和离开了的机构**都留着**：旧地址是历史往来的钥匙，
    // 而「她以前在 CultureHub」正是那四封信为什么是她的的原因。
    const [{ data: emails }, { data: orgs }] = await Promise.all([
      supa.from('v_pa_contact_emails').select('*'),
      supa.from('v_pa_contact_orgs').select('*'),
    ])
    const byC = (rows, sort) => {
      const out = {}
      for (const r of rows || []) (out[r.contact_id] ||= []).push(r)
      for (const k in out) out[k].sort(sort)
      return out
    }
    // 在用的排前面，主邮箱最前
    const emailsOf = byC(emails, (a, b) =>
      (a.until ? 1 : 0) - (b.until ? 1 : 0) || (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
    // 现在的机构排前面，离开了的排后面
    const orgsOf = byC(orgs, (a, b) => (a.until ? 1 : 0) - (b.until ? 1 : 0))

    // 邮件 + 你记的笔。升序 —— cues.js 的判据靠这个顺序（最后一封在末尾）。
    const { data: msgs, error: me } = await supa
      .from('v_pa_pursuit_messages').select('*')
      .not('contact_id', 'is', null).order('created_at')
    if (me) return empty(FELL_BACK.QUERY_FAILED, me.message)

    const msgsByContact = {}
    for (const m of msgs || []) (msgsByContact[m.contact_id] ||= []).push(m)

    // 机构也进通讯录。通讯录装的是**你会写信的对象**，不是只装人——
    // residency@culturehub.org 来回七封，它当然该有一条。
    const { data: orgRows } = await supa
      .from('v_pa_orgs').select('*').order('mail_count', { ascending: false })

    return {
      contacts: contacts.map((c) => ({
        ...c,
        pursuits: lines[c.id] || [],
        emails: emailsOf[c.id] || (c.email ? [{ email: c.email, is_primary: true }] : []),
        orgs: orgsOf[c.id] || (c.org ? [{ org: c.org, role: c.role }] : []),
      })),
      orgs: orgRows || [],
      msgsByContact,
      source: 'live', reason: null, detail: null,
    }
  } catch (e) {
    return empty(FELL_BACK.QUERY_FAILED, e.message)
  }
}
