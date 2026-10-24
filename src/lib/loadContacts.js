import { supa, DB_CONFIGURED, FELL_BACK, selectAll } from './backends.js'

// 人这一层的读面。
//
// 设计稿：docs/specs/2026-08-08-people-layer-design.md
//
// 跟 loadPursuits 一个姿势：连不上 / 库是空的，都退回一个**说得清原因**的空结果，
// 而不是无声地显示「没有人」——空页可以，骗人不行。
//
// 这儿**不再拉往来**（2026-08-21）。原来有一条「全库带正文的消息」查询喂
// msgsByContact——查下来它是个死 prop：People.jsx 解构了但没人读，名片页
// 打开时 PersonFocus 自己按人现拉。而这条死查询一次 4.2 MB（含全部邮件
// 原文），是流量打爆的第二大头；并且 1275 行早过了 PostgREST 的 1000 行
// 上限，返回的还是静默截断的——跟 loadPursuits 开头记的是同一种事故。
// 界面上没有任何东西靠它，删。

const empty = (reason, detail) => ({
  contacts: [], orgs: [], source: 'empty', reason, detail,
})

export async function loadContacts() {
  if (!DB_CONFIGURED) return empty(FELL_BACK.NO_CONFIG)
  try {
    const { data: contacts, error: ce } = await selectAll(() => supa
      .from('v_pa_contacts').select('*')
      .order('last_touch_at', { ascending: false, nullsFirst: false }).order('id'))
    if (ce) return empty(FELL_BACK.QUERY_FAILED, ce.message)
    // 通讯录空着**不能就此返回**(2026-10-08):原来这里一看没人就直接回空,后面「等你点头的新联系人」
    // 根本没去查——新用户通讯录一定是空的,于是收完信判出的 116 个人一个都看不见。照常往下查,最后再标空

    // 他挂在哪几条机会线上 —— 这是「人是独立一层、两区共用同一张名片」
    // 落地之后你**看得见**的样子。
    //
    // 按**班底**算，不是按 pursuits.contact_id。那个字段是单数，一条线只能
    // 指一个人；可一条线的对面从来不止一个：ASU 那条博士线上有三个。
    // 按 contact_id 读的话，另外两位打开卡是「没挂机会线」——而她们正是
    // 这条线接下来要写信的对象。
    const { data: pursuits } = await supa
      .from('v_pa_contact_lines').select('contact_id,pursuit_id,title,stage,note')
    const lines = {}
    for (const p of pursuits || []) {
      if (!p.contact_id) continue
      ;(lines[p.contact_id] ||= []).push({
        id: p.pursuit_id, title: p.title, stage: p.stage, note: p.note,
      })
    }

    // 多个邮箱 + 多个机构，各带起止日期。
    // 停用的地址和离开了的机构**都留着**：旧地址是历史往来的钥匙，
    // 而「她以前在 CultureHub」正是那四封信为什么是她的的原因。
    const [{ data: emails }, { data: orgs }] = await Promise.all([
      selectAll(() => supa.from('v_pa_contact_emails').select('*').order('contact_id').order('email')),
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

    // 机构也进通讯录。通讯录装的是**你会写信的对象**，不是只装人——
    // residency@culturehub.org 来回七封，它当然该有一条。
    const { data: orgRows } = await supa
      .from('v_pa_orgs').select('*').order('mail_count', { ascending: false })

    // 还不认识的地址 —— 加人的真入口。系统自己发现有陌生地址在跟你写信。
    const { data: strangers } = await selectAll(() => supa.from('v_pa_unknown_senders').select('*').order('email'))

    // 0121 端出来的：被抄送在某条线上、但跟线上的人不同机构，或看不出是人还是信箱的
    // 那些地址。它们自己一封信都没发过，所以 v_pa_unknown_senders 里没有；理由（谁在
    // 哪条线抄送的）在判定表里，端出来时带着，名片一键就能加。
    const { data: greet } = await selectAll(() => supa.from('v_pa_greetable').select('*').order('email'))
    const seen = new Set((strangers || []).map((r) => String(r.email).toLowerCase()))
    const copied = (greet || [])
      .filter((r) => /抄送|也发给了|回信/.test(r.why || '') && !seen.has(String(r.email).toLowerCase()))
      .map((r) => ({
        email: r.email, 封数: 0, 他发来的: 0, 你发去的: 0, 第一次: null, 最近一次: null,
        信头署名: r.name || null, 出现在哪些机会线: [],
        why: r.why,
        prefill: { kind: r.verdict === 'shared_box' ? 'shared_box' : 'person',
                   name: r.name || '', org: r.org || '', notes: r.why || '' },
      }))

    // 一伙人（0122）：一串信里好几个人来回说话，其中还有人没进通讯录。
    // 读不到（老库没这个口）就当没有，别把整页拖死。
    const { data: groups } = await supa.rpc('pa_group_threads', { p_min_people: 5 })

    return {
      contacts: (contacts || []).map((c) => ({
        ...c,
        pursuits: lines[c.id] || [],
        emails: emailsOf[c.id] || (c.email ? [{ email: c.email, is_primary: true }] : []),
        orgs: orgsOf[c.id] || (c.org ? [{ org: c.org, role: c.role }] : []),
      })),
      orgs: orgRows || [],
      strangers: [...copied, ...(strangers || [])],
      groups: Array.isArray(groups) ? groups : [],
      ...(contacts?.length ? { source: 'live', reason: null, detail: null } : { source: 'empty', reason: FELL_BACK.EMPTY, detail: null }),
    }
  } catch (e) {
    return empty(FELL_BACK.QUERY_FAILED, e.message)
  }
}
