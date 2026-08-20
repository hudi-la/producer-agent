import { supa, BRAIN } from './backends.js'
import { streamChat, NoStream } from './chat.js'

// 人这一层的写口。分工跟 chat.js 一模一样：
//  · 「你自己改自己名片上的字段」—— 浏览器直连走 anon，靠 security definer 函数，
//    能改的列写死在 0034 里，anon 拿不到别的写权限。
//  · 「让 Fairwind 去想」（起草、收信）—— 走本机 sidecar，那需要 service_role。
//
// 好处跟当初一样：sidecar 开不开、是不是最新的，都不影响你整理自己的名片。

const rpc = async (fn, args) => {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { data, error } = await supa.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

/** 建 / 改一个人。只传要改的字段——没传的一格都不动。 */
export const upsertContact = (f = {}) => rpc('pa_upsert_contact', {
  p_id: f.id ?? null,
  p_name: f.name ?? null,
  p_email: f.email ?? null,
  p_org: f.org ?? null,
  p_role: f.role ?? null,
  p_notes: f.notes ?? null,
  p_channels: f.channels ?? null,
  p_intro_by: f.intro_by ?? null,
  p_next_touch_at: f.next_touch_at ?? null,
  p_next_touch_why: f.next_touch_why ?? null,
  p_cadence_days: f.cadence_days ?? null,
})

/** 认领一条邮件往来。登记过的 thread 才会被同步——永远不遍历信箱（0027 的原则）。 */
export const claimThread = (contactId, threadId) =>
  rpc('pa_claim_contact_thread', { p_contact_id: contactId, p_thread_id: threadId })

/**
 * 线下见了一面，记一笔。
 * 一条记录同时干三件事：更新「上次碰」、触发 48 小时由头、留下「上次聊到哪」。
 */
/**
 * 记一次接触。pursuitId 可选——这次聊的跟某条线有关就一起挂上。
 *
 * **同时挂两边，不是搬过去**：它长在人身上（你是跟这个人见的面），
 * 那条线的卷宗里也看得见（那次聊的正是那个项目的事）。
 */
export const logMeet = (contactId, text, pursuitId = null) =>
  rpc('pa_add_contact_message', {
    p_contact_id: contactId, p_role: 'note', p_kind: 'meet', p_content: text,
    p_pursuit_id: pursuitId,
  })

/** 微信 / 电话 / 线下聊完了，打个卡。系统看不见那些渠道，所以靠你这一下。 */
export const checkin = (contactId) => rpc('pa_contact_checkin', { p_contact_id: contactId })

/** 回谢过介绍人了。由头③ 立刻不再提。 */
export const markIntroThanked = (contactId) =>
  rpc('pa_mark_intro_thanked', { p_contact_id: contactId })

/**
 * 还不认识的地址：在跟你来往，但库里不知道是谁。
 *
 * **这就是「加个人」的真入口。** 你不用去 Gmail 里复制什么链接——
 * 系统自己发现有陌生地址在跟你写信，你只需要回答一句「他是谁」。
 */
export async function fetchUnknownSenders() {
  if (!supa) return []
  const { data, error } = await supa.from('v_pa_unknown_senders').select('*')
  return error ? [] : (data || [])
}

/**
 * 「这个地址是某某的」。
 * 认领一次，那个地址名下**所有历史往来当场归位**——不用重跑迁移，不用手工挑信。
 */
export const claimEmail = (email, contactId, note) =>
  rpc('pa_claim_email', { p_email: email, p_contact_id: contactId, p_note: note ?? null })

/**
 * 「这是机构的共享信箱」。
 * 它不是人，所以它的往来从所有名片上撤下来，只留在机会线上。
 */
export const markOrgMailbox = (email, org, label, notes) =>
  rpc('pa_mark_org_mailbox', {
    p_email: email, p_org: org, p_label: label ?? null, p_notes: notes ?? null,
  })

/** 这个人认领了哪几条往来。名片上要显示，也是「更新最新信息」能不能按的前提。 */
export async function fetchThreads(contactId) {
  if (!supa) return []
  const { data, error } = await supa
    .from('v_pa_threads').select('*').eq('contact_id', contactId).order('created_at')
  return error ? [] : (data || [])
}

/**
 * 这个人名下**要发的信**。
 *
 * 只取 kind='email'。别的交付物（营销素材、项目陈述、申请表）是交给**机构**的，
 * 归那条机会线，不归这个人——名片右栏摆一份「营销素材 6 样」等于在说
 * 「这是要发给 Mattie 的」，那是假的。
 */
export async function fetchContactDeliverables(contactId) {
  if (!supa) return []
  const { data, error } = await supa
    .from('v_pa_deliverables').select('*').eq('contact_id', contactId).eq('kind', 'email')
  return error ? [] : (data || [])
}

// ── 走 sidecar 的那几件 ─────────────────────────────────────────

const post = async (path, body) => {
  let res
  try {
    res = await fetch(`${BRAIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (_) {
    throw new Error('Fairwind 的脑子没开 —— 另开一个终端跑 npm run brain')
  }
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out?.error) throw new Error(out?.error || `脑子出错了（${res.status}）`)
  return out
}

/** 收这个人认领的那几条 thread 的新信。 */
/**
 * 「这个地址背后是谁」—— Fairwind 去信箱里读，自己判断。
 *
 * 加人原来是让你填表，后来是让你从下拉框挑人。**两个都错**：
 * 几千个联系人的时候你挑不动，而这些答案信里全都有——签名里有名字和网站，
 * 正文里有机构和头衔，主题行里常写着谁介绍的。该干这活的是它，不是你。
 *
 * 它**只提议不写库**。认错人比不认更麻烦，所以最后那下点头永远是你的。
 */
export const identifyEmail = (email) => post('/identify', { email })

/**
 * 认领之后，人跟着信一起归位：这个地址名下已经躺在某条线上的信，
 * 人/信箱直接挂成那条线的相关方。纯规则（信就在线上，证据确凿）。
 * 返回挂上的线的标题，好在界面报一声。
 */
export const attachAddressLines = (email, { contactId = null, mailbox = null } = {}) =>
  rpc('pa_attach_address_lines', {
    p_email: email, p_contact_id: contactId, p_mailbox: mailbox,
  })

export const refreshContact = (id) => post('/refresh', { contact_id: id })

/** 跟 Fairwind 说一句（起草回信就是从这儿来的）。 */
export const sayToContact = (id, text) => post('/chat', { contact_id: id, text })

/**
 * 同上，但边想边出字。脑子是旧的就退回上面那条 —— 慢，但不至于说不了话。
 * 读流那套在 chat.js 里，跟机会线共用一份。
 */
export async function sayToContactStream(id, text, runId, onEvent) {
  try {
    return await streamChat({ contact_id: id, text, ...(runId ? { run_id: runId } : {}) }, onEvent)
  } catch (e) {
    if (e instanceof NoStream) return sayToContact(id, text)
    throw e
  }
}

/**
 * 把一份定了稿的信放进 Gmail 草稿箱。
 * **只建草稿，不发送** —— 不是我们关掉的，是 claude.ai 的 Gmail 连接器
 * 整套工具里根本没有 send。最后那下发送永远是你的手。
 */
export const draftToGmail = (deliverableId) => post('/gmail-draft', { deliverable_id: deliverableId })
