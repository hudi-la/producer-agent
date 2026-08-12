import { supa } from './backends.js'

// 一条线的班底，和由它推导出来的往来。
//
// 全部走 anon 直连——**脑子没开也看得见、也挂得上人**。挂一个人到一条线上
// 只是写一行关系，不需要 Gmail、不需要模型。跟 people.js 那套分工一样：
// 要判断的才找脑子，记事实的自己来。

const rpc = async (fn, args) => {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { data, error } = await supa.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

/** 这条线上都有谁。人和机构共享信箱都在里面（is_mailbox 分）。 */
export async function fetchParties(pursuitId) {
  if (!supa) return []
  const { data, error } = await supa
    .from('v_pa_pursuit_parties').select('*').eq('pursuit_id', pursuitId)
    .order('mails', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

/**
 * 这条线的往来。**推导出来的，不是盖章盖上去的**——挂在这条线名下那些人
 * 的邮件全在这儿，所以他们以后再来信，不用做任何事就会出现。
 *
 * on_this_line 分两段：
 *   true  —— 就是这条线的事，默认展开
 *   false —— 跟这个人的别的往来，折起来放一行「还有 N 封」
 */
export async function fetchPursuitMail(pursuitId) {
  if (!supa) return []
  const { data, error } = await supa
    .from('v_pa_pursuit_mail').select('*').eq('pursuit_id', pursuitId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

/** 挂一个人（或一个机构共享信箱）到这条线上。 */
export const attachParty = (pursuitId, { contactId, mailbox, note }) =>
  rpc('pa_attach_party', {
    p_pursuit_id: pursuitId,
    p_contact_id: contactId ?? null,
    p_mailbox: mailbox ?? null,
    p_note: note ?? null,
    p_by: 'you',
  })

/** 摘掉。**只摘关系，不动信**——信还在那个人名下，一封都不会少。 */
export const detachParty = (id) => rpc('pa_detach_party', { p_id: id })

/** 挂人时的候选：通讯录里的人 + 已登记的机构共享信箱。 */
export async function fetchCandidates() {
  if (!supa) return { people: [], mailboxes: [] }
  const [{ data: people }, { data: mailboxes }] = await Promise.all([
    supa.from('v_pa_contacts').select('id, name, org, role').order('name'),
    supa.from('v_pa_org_mailboxes').select('email, org').order('org'),
  ])
  return { people: people || [], mailboxes: mailboxes || [] }
}
