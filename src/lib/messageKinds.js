// 一条消息「是什么」——全项目只在这里判一次（2026-10-24）。
//
// pursuit_messages 一张表里装着十几种 role × kind 的组合：你说的话、Fairwind 说的话、
// 收到的信、发出的信、预约发送、Gmail 草稿、「信到了」告知、你记的笔、Fairwind 拨提醒时
// 记的决定……原来每个组件、每段提示词各写各的 role/kind 判断（约 70 处），于是同一条消息
// 在机会线页、人卡页、提示词里是三种身份：Gmail 草稿在提示词里被当成「你说的话」，
// 「信到了」告知被当成「Fairwind 说的话」，Fairwind 推出来的决定被当成「线下事实」。
//
// 现在一律先过 kindOf(m)，拿到一个类型名，再查 KINDS 表：
//   fact    这条能不能当事实凭证（只有真实邮件和你亲手记的笔是事实）
//   source  谁产生的：gmail / you / fairwind / system
//   group   进提示词的哪一组（mail / notes / inferred / chat / drafts / skip）
//   view    界面怎么画（letter / arrival / note / inferred / brief / draft / bubble）
//
// 后端（brain/contextHistory.js）和前端（PursuitFocus / PersonFocus）共用这一份。

export const KINDS = {
  mail_in:        { fact: true,  source: 'gmail',    group: 'mail',     view: 'letter',   label: '收到的信' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
  mail_out:       { fact: true,  source: 'gmail',    group: 'mail',     view: 'letter',   label: '发出的信' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
  mail_scheduled: { fact: false, source: 'gmail',    group: 'mail',     view: 'letter',   label: '预约发送（还没送出）' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
  arrival:        { fact: false, source: 'system',   group: 'skip',     view: 'arrival',  label: '信到了的告知' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
  gmail_draft:    { fact: false, source: 'gmail',    group: 'drafts',   view: 'none',     label: 'Gmail 草稿' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
  note_you:       { fact: true,  source: 'you',      group: 'notes',    view: 'note',     label: '你记的一笔' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
  memo_you:       { fact: true,  source: 'you',      group: 'notes',    view: 'note',     label: '记住的一句' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
  decision_fw:    { fact: false, source: 'fairwind', group: 'inferred', view: 'inferred', label: 'Fairwind 的判断' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
  chat_you:       { fact: false, source: 'you',      group: 'chat',     view: 'bubble',   label: '你说的话' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
  chat_fw:        { fact: false, source: 'fairwind', group: 'chat',     view: 'bubble',   label: 'Fairwind 说的话' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
  brief:          { fact: false, source: 'fairwind', group: 'chat',     view: 'brief',    label: '讲懂这个机会' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
  draft_old:      { fact: false, source: 'fairwind', group: 'drafts',   view: 'draft',    label: '旧版草稿' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
  other:          { fact: false, source: 'system',   group: 'chat',     view: 'bubble',   label: '其他' },   // i18n-ok 类型名，后端拼提示词用；界面不直接显示
}

const future = (at, now) => Boolean(at) && new Date(at) > now

/**
 * 这条消息是哪一种。now 传得进来是为了测试能写死「现在」。
 *
 * 判据顺序有讲究：kind 比 role 可靠（role='artist' 既可能是你说的话、你发的信，也可能是
 * 一封 Gmail 草稿），所以先看 kind，role 只用来分方向。
 */
export function kindOf(m, now = new Date()) {
  if (!m) return 'other'
  const meta = m.meta || {}
  switch (m.kind) {
    case 'email':
      if (m.role === 'org') return 'mail_in'
      return future(m.created_at, now) ? 'mail_scheduled' : 'mail_out'
    case 'arrival':     return 'arrival'
    case 'gmail_draft': return 'gmail_draft'
    case 'brief':       return 'brief'
    case 'draft':       return 'draft_old'
  }
  if (m.role === 'note' || m.kind === 'meet' || m.kind === 'decision' || m.kind === 'memo' || m.kind === 'note') {
    // Fairwind 拨提醒时记的那条笔（pa_apply_state_move 写的）带着 meta.state_move。
    // 它是 Fairwind 的判断，不是你说过的事实——哪怕笔的正文是你的原话。
    if (meta.state_move) return 'decision_fw'
    if (meta.memo_by === 'fairwind') return 'decision_fw'
    return m.kind === 'memo' ? 'memo_you' : 'note_you'
  }
  if (m.role === 'artist') return 'chat_you'
  if (m.role === 'producer') return 'chat_fw'
  return 'other'
}

export const infoOf = (m, now) => KINDS[kindOf(m, now)]

/** 真实邮件（含预约发送）。替代散落各处的 `kind === 'email'`。 */
export const isMail = (m) => m?.kind === 'email'

/** 已经真的发出去了的信（不含预约、不含草稿）。 */
export const isSentMail = (m, now = new Date()) => kindOf(m, now) === 'mail_out'

// ── 草稿 ↔ 已发出的信 ───────────────────────────────────────────
//
// Gmail 草稿一旦在 Gmail 里被发出，同步回来的是一封新的 email，草稿那一行不会自己消失。
// 线上 35 份挂着的草稿里 15 份早已发出——Fairwind 一直以为它们没发。
// 这里按「去掉空白后的开头一段相同、且发出时间不早于草稿」认亲。只读、不改库：
// 认出来的草稿在提示词里写明「已于某日发出」，界面不再把它当没发的。

const squash = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()
const OPENING = 80

export function sentCopyOf(draft, msgs = []) {
  const head = squash(draft?.body_raw || draft?.body || draft?.content).slice(0, OPENING)
  if (head.length < 20) return null
  const since = draft?.created_at ? new Date(draft.created_at).getTime() - 86400000 : 0
  const now = new Date()
  return msgs.find((x) => isSentMail(x, now) && !x.deleted_at &&
    (!x.created_at || new Date(x.created_at).getTime() >= since) &&
    squash(x.body_raw || x.content).startsWith(head)) || null
}

/**
 * Fairwind 判断笔在界面上的正文：它判了什么（小卡那行）、凭什么；你当时那句话放在最后当引用。
 * 库里那条笔的正文一个字不改——过去有些笔的正文是你的问句（「这个是什么啊」），
 * 直接显示会像是你记下的事实。
 */
export function judgedText(m, whyLine = (w) => `凭什么：${w}`) {   // i18n-ok 缺省给后端用，界面一律传 t() 进来
  const sm = m?.meta?.state_move || {}
  const said = String(m?.content || '').trim()
  const auto = /^(聊天里定的|Decided in chat)/.test(said)
  return [sm.line || said, sm.why ? whyLine(sm.why) : '', said && !auto && said !== sm.line ? `> ${said.split('\n')[0].slice(0, 120)}` : '']
    .filter(Boolean).join('\n\n')
}
