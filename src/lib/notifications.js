import { supa, DB_CONFIGURED, FELL_BACK, BRAIN, brainFetch, selectAll } from './backends.js'
import { BUMP_WAIT } from './cues.js'
import { day as dayOf } from './when.js'

// 顶栏那个 🔔 的读面。
//
// 设计稿：docs/specs/2026-08-18-notifications-design.md
//
// ══ 条目一条都不存，全部现算 ═══════════════════════════════════
//
// 你在邮箱里回了一封信，下一次拉事实的时候那条通知自己就没了——
// **「自动勾掉」不是一个功能，它是现算这件事本身。**
//
// 反过来，存一条待办再想办法作废（next_action 那套）就得真去实现自动勾掉，
// 而且只在收信时才有机会判：你从别的信箱回的、当面说的，它永远不知道。
//
// 存的只有两样，每一样都关于一个**不会变的事实**：
//   letter_verdicts —— 那一封信要不要回（信的内容永远不变）
//   cue_marks       —— 你按的 ✓ 和 ✕（锚在事实的日期上）

/** 分界线用 BUMP_WAIT[0] —— 项目里已有的节奏常数，不另发明一个数。 */
export const FRESH_DAYS = BUMP_WAIT[0]

// ══ state 那一半（0094/0098 的 v_pa_state）════════════════════
//
// 一条线 / 一个人同时只有一个 state；到点没到点（zone）是库里算的。
// 这儿只做一件事：分区（到点的 / 还没到点的）和排序。
//
// ══ 线和人不再分家（2026-08-21，他拍的）═══════════════════════
//
// 原来这儿按「这件事挂在线上还是挂在人身上」分成两处：线的进 🔔，
// 人的进人际管理页。当初分家是因为**那会儿状态机还没做好**，一大片人
// 被判成「还需要回复」，全塞进 🔔 会把真正的事淹掉。
//
// 那批噪音清干净之后，分家只剩副作用，而且是他撞上的那种：
// Steven 约了 8/25 通话——**全部见面里最近的一场**——而 🔔 里那一栏
// 摆着 9/3 和 9/11 两场，唯独最近的这场不在，因为 Steven 没挂在任何线上。
// 「我这周约了谁」这个问题，本来不该分两个页面回答。
//
// 判据错在维度上：分的是「挂在什么上面」，可你要问的是「什么时候、该干嘛」。
// 现在一份 v_pa_state 只按到点没到点分区，线和人一起排。

/** 分区 + 排序。该动的紧的在上（due 早的先），等待的也是近的在上。 */
export function splitStates(rows) {
  const due = [], waiting = []
  for (const r of rows || []) (r.zone === 'due' ? due : waiting).push(r)
  const 早的在上 = (a, b) => String(a.due_at || '').localeCompare(String(b.due_at || ''))
  due.sort(早的在上); waiting.sort(早的在上)
  return { due, waiting }
}

/**
 * 【已处理】：表单交了、微信里说了、当面聊了 —— 系统看不见邮箱外的事，
 * 靠你这一下。**它是一条真的笔**（进时间线，留痕迹），不是把提醒抹掉。
 *
 * 立刻生效靠第二步：给这条笔自己打上 resolves 标签（situation 记着
 * 是按钮按的）。不打的话要等 brain 下一轮判那条笔，提醒会多挂几分钟。
 * OWE_THANKS 另有一个落笔处（contacts.intro_thanked_at），一并落。
 */
export async function markHandled(it, note = '已处理（在通知栏按的）') { // i18n-ok 存进库的笔记原文（进时间线、brain 读它），跟库里已有的同一句
  const { data: row, error } = await supa.rpc(
    it.subject_kind === 'pursuit' ? 'pa_add_pursuit_note' : 'pa_add_contact_message',
    it.subject_kind === 'pursuit'
      ? { p_pursuit_id: it.subject_id, p_text: note, p_kind: 'note' }
      : { p_contact_id: it.subject_id, p_role: 'note', p_kind: 'note', p_content: note },
  )
  if (error) throw new Error(error.message)
  const noteId = row?.id
  if (noteId) {
    await supa.rpc('pa_tag_message', {
      p_message_id: noteId, p_situation: '已处理按钮', // i18n-ok 存进库的标签值
      p_resolves: true, p_resolves_why: '你按了【已处理】', p_gist: note, // i18n-ok 存进库的依据原文，跟 brain 写的同一列
    })
  }
  if (it.state === 'OWE_THANKS') {
    await supa.rpc('pa_thank_introducer', { p_introducer: it.subject_id })
  }
  return true
}

/**
 * 多久以内的往来才值得花钱重判。
 *
 * 30 天：一段还活着的交流，最后一次往来不会比这更久。再往前的，
 * 「有没有约定下一个时间点」这个问题答案必然是 null ——
 * 真跑过一批 12 个，11 个是 null。
 */
export const REJUDGE_WINDOW_DAYS = 30

const DAY = 86400000
const daysBetween = (a, b) =>
  Math.round((new Date(dayOf(b) + 'T00:00:00') - new Date(dayOf(a) + 'T00:00:00')) / DAY)

/**
 * 分层。**每一层都数得出来、都点得开**——静默藏起来 = 你以为没有，其实有，
 * 那是这个项目最不能忍的那种谎。
 *
 * - todo  该动的：有由头的全在这儿，新的在上面。**面板摆的就是它。**
 * - muted 被判为不用回的（cue 是 null、只有 verdict 的那些）
 *
 * hand / old 不再是面板上的两段了（那道分界线看着像两类事，其实只是新旧），
 * 但这两个数还在：🔔 上那个角标只数 hand —— 七天前那笔老账该在列表里待着，
 * 不该天天顶着红点冲你喊。
 *
 * - hand  手头：7 天内的事实
 * - old   老账：7 天以前的，加上「碰满三次停了」那种
 */
export function layer(items, today = new Date()) {
  const hand = [], old = [], muted = []
  for (const it of items) {
    if (!it.cue) { muted.push(it); continue }
    if (it.cue.stopped || daysBetween(it.cue.at, today) > FRESH_DAYS) old.push(it)
    else hand.push(it)
  }
  const 新的在上面 = (a, b) => String(b.cue?.at || '').localeCompare(a.cue?.at || '')
  return { hand: hand.sort(新的在上面), old: old.sort(新的在上面), muted,
           todo: [...hand, ...old].sort(新的在上面) }
}


const empty = (reason, detail) => ({
  due: [], waiting: [],
  unclaimed: 0, unjudged: [], stale: [], source: 'empty', reason, detail,
})

/**
 * 拉一遍。事实、判定、记号三张读面各一次，前端拼。
 *
 * 「今天」算一次给所有行用 —— 免得渲染到一半跨过午夜，
 * 前后两半用两个「今天」。
 */
export async function loadNotifications() {
  if (!DB_CONFIGURED) return empty(FELL_BACK.NO_CONFIG)
  try {
    const { data: facts, error: fe } = await selectAll(() => supa.from('v_pa_cue_facts').select('*').order('subject_kind').order('subject_id'))
    if (fe) return empty(FELL_BACK.QUERY_FAILED, fe.message)

    // 「这封要不要回」的旧判决（letter_verdicts）2026-10-24 退役：它跟状态机各判一份、结论常相反，
    // 面板早就不用它了。要不要回只看下面的 state。
    // state 那一半：该动的 / 等待，全是库里现算的（0094/0098）。
    // 旧的五种由头（cues.js 那套）不再进面板 —— 它们的信息都并进了 state。
    const { data: states, error: se } = await supa.from('v_pa_state').select('*')
    if (se) return empty(FELL_BACK.QUERY_FAILED, se.message)
    const rows = (states || []).map((r) => ({
      key: `${r.subject_kind}|${r.subject_id}`, ...r, name: r.subject_name,
    }))

    // 没归到任何线的往来：不逐条列（那边有自己的处理流程 ——
    // 人际管理页的「等你点头」），这儿只报个数，别让它是隐形的。
    const { count: unclaimed, error: ue } = await supa
      .from('v_pa_unknown_senders').select('*', { count: 'exact', head: true })
    if (ue) return empty(FELL_BACK.QUERY_FAILED, ue.message)

    const today = new Date()
    // 脏了的：最后一件事（信 / 你记的一笔 / **移卡**）晚于上次重判的水位。
    // 「脏不脏」是库里算出来的（v_pa_cue_facts.stale），不是这儿存的标记
    // ——存的会跟事实分叉。
    //
    // **但脏 ≠ 值得判。** 重判问的是「这段交流约定了下一个时间点吗」，
    // 而一条两年前发出去没人回的冷邮件，答案必然是 null ——
    // 上一批 12 个里 11 个是 null。由头本来就从事实现算，模型加不进东西。
    //
    // 所以只判**最近真的聊过**的那些。更老的照样算脏（事实摆在那儿），
    // 只是不主动花钱去问模型；它们的由头一样出得来。
    const 值得判 = (f) =>
      f.stale && f.last_event_at &&
      Date.now() - new Date(f.last_event_at) < REJUDGE_WINDOW_DAYS * 86400000
    const stale = (facts || []).filter(值得判).map((f) => ({
      kind: f.subject_kind, id: f.subject_id,
      last_in_id: f.last_in_id || null, upto: f.last_event_at,
    }))
    // 最近的排前面 —— 先判最可能有新约定的那些
    stale.sort((a, b) => String(b.upto).localeCompare(String(a.upto)))

    return { ...splitStates(rows),
             unclaimed: unclaimed || 0,
             unjudged: [], stale,
             source: 'live', reason: null }
  } catch (e) {
    return empty(FELL_BACK.QUERY_FAILED, e.message)
  }
}

/** 打一个记号。mark 传 'done' | 'off' | null（null = 撤销）。 */
export async function markCue(item, mark) {
  const { data, error } = await supa.rpc('pa_mark_cue', {
    p_kind: item.subject_kind, p_id: item.subject_id,
    p_via: item.cue.via, p_at: item.cue.at, p_mark: mark,
  })
  if (error) throw new Error(error.message)
  return Boolean(data)
}

/**
 * 改一条等待的到点日。默认天数对这个 case 不合适（「等到周四再催」）时
 * 的落笔口 —— 原来这个结论只能活在对话里，没处落（Arboretum 的教训）。
 * 只动 wait_days，谁改的、凭什么记进标签的 situation。
 */
export async function rescheduleWait(it, due, why = null) {
  const { error } = await supa.rpc('pa_reschedule_wait', {
    p_anchor: it.anchor_id, p_due: due, p_why: why,
  })
  if (error) throw new Error(error.message)
  return true
}

// muteAway / unmuteLetter / unmarkAllOff 于 2026-08-20 退役 ——
// 「被判为不用回的」那层从面板上删了，✕ 和「放回」没有了立足的行。
// 记号和判决都还在库里（cue_marks / letter_verdicts），要复活翻 git。

/**
 * 重判一批对象：这段交流有没有约定下一个时间点、最后那封信要不要回。
 *
 * **一次判一批，量按对象数走**（几十个），不按信数（几千封）。
 * 判不成不抛 —— 水位不推进，下次打开再判，不会假装判过了。
 */
export async function rejudge(subjects) {
  if (!subjects?.length) return { judged: 0, failed: 0, touched: 0 }
  try {
    const r = await brainFetch(`${BRAIN}/subjects/rejudge`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjects }),
    })
    const out = await r.json().catch(() => null)
    if (!r.ok || !out || out.error) return { judged: 0, failed: subjects.length, touched: 0 }
    return out
  } catch (_) {
    return { judged: 0, failed: subjects.length, touched: 0 }
  }
}

/** 一批判多少个。按对象数，不按信数。 */
export const REJUDGE_BATCH = 12

