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
  contacts: [], msgsByContact: {}, source: 'empty', reason, detail,
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

    // 邮件 + 你记的笔。升序 —— cues.js 的判据靠这个顺序（最后一封在末尾）。
    const { data: msgs, error: me } = await supa
      .from('v_pa_pursuit_messages').select('*')
      .not('contact_id', 'is', null).order('created_at')
    if (me) return empty(FELL_BACK.QUERY_FAILED, me.message)

    const msgsByContact = {}
    for (const m of msgs || []) (msgsByContact[m.contact_id] ||= []).push(m)

    return {
      contacts: contacts.map((c) => ({ ...c, pursuits: lines[c.id] || [] })),
      msgsByContact,
      source: 'live', reason: null, detail: null,
    }
  } catch (e) {
    return empty(FELL_BACK.QUERY_FAILED, e.message)
  }
}
