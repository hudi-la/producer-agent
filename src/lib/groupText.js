// 「一伙人」那一格上的话。纯函数，好测。
//
// 一串信里好几个人来回说话，那是一伙人（驻地的同期、一个展的参展者、一个
// 工作坊的学员）。他愿意把他们都收进通讯录，但要写清**在哪个活动里合作过**。
// 活动名预填成信的主题，他改一改就收。
import { t } from '../i18n/index.js'

/** 主题去掉 Re:/Fwd: 那些前缀。空的说「无主题」，别留一个空格。 */
export function cleanSubject(s) {
  const out = String(s || '').replace(/^\s*((re|fwd?|fw|回复|转发|答复)\s*:\s*)+/i, '').trim()  // i18n-ok 正则匹配邮件主题里的中文前缀
  return out || t('（无主题）')
}

const md = (s) => {
  const [, m, d] = String(s || '').split('-')
  return m && d ? `${Number(m)}/${Number(d)}` : '—'
}
const ym = (s) => {
  const [y, m] = String(s || '').split('-')
  return y && m ? `${y}-${m}` : ''
}

/** 谁发起的。你自己发起的说「你」。 */
export const starterName = (g) =>
  g?.starter?.is_me ? t('你') : (g?.starter?.name || g?.starter?.email || t('有人'))

/** 一伙人的概况：谁发起、几个人、来回几封、什么时候。 */
export function groupLine(g) {
  const who = starterName(g)
  const span = g.first_at === g.last_at ? md(g.first_at) : `${md(g.first_at)} → ${md(g.last_at)}`
  return t('{who} {date} 发起，{people} 个人在场，{senders} 个人说过话，来回 {mails} 封（{span}）',
    { who, date: md(g.first_at), people: g.n_people, senders: g.n_senders, mails: g.n_mails, span })
}

/** 还没进通讯录、也不是共享信箱、他也没否过的那些。 */
export const unknownMembers = (g) =>
  (g?.members || []).filter((m) => !m.known && !m.rejected && !m.generic)

/** 已经认识的（给他一个「哦，是那一伙」的锚点）。 */
export const knownMembers = (g) => (g?.members || []).filter((m) => m.known)

/** info@ 这种：不跟着一起收，单独说一句。 */
export const genericMembers = (g) =>
  (g?.members || []).filter((m) => !m.known && m.generic)

/** 写进每个人名片「关系记忆」的那句。 */
export function memberNote(g, event) {
  const who = starterName(g)
  return t('在「{event}」里一起合作的人：{who} {month} 发起的信串「{subject}」，同在收件人里（一伙人一起收进通讯录，0122）',
    { event, who, month: ym(g.first_at), subject: cleanSubject(g.subject) })
}
