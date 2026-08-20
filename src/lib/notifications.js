import { supa, DB_CONFIGURED, FELL_BACK, BRAIN } from './backends.js'
import { cuesFor, cueKey, BUMP_WAIT } from './cues.js'
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

/**
 * 邮件类的东西归线不归人 —— 跟 cues.js 里那条同一个判据。
 * 「被判为不用回的」也是邮件类的，所以也得压，不然一封信在人和线上各列一条。
 */
const 归了线 = (f) => f.subject_kind === 'contact' && Boolean(f.mail_on_line)

const empty = (reason, detail) => ({
  hand: [], old: [], muted: [], todo: [], unjudged: [], stale: [], source: 'empty', reason, detail,
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
    const { data: facts, error: fe } = await supa.from('v_pa_cue_facts').select('*')
    if (fe) return empty(FELL_BACK.QUERY_FAILED, fe.message)

    const ids = [...new Set((facts || []).map((f) => f.last_in_id).filter(Boolean))]
    const [{ data: verdicts }, { data: marks }] = await Promise.all([
      ids.length ? supa.from('v_pa_letter_verdicts').select('*').in('gmail_message_id', ids)
                 : Promise.resolve({ data: [] }),
      supa.from('v_pa_cue_marks').select('*'),
    ])
    const vOf = Object.fromEntries((verdicts || []).map((v) => [v.gmail_message_id, v]))
    const marked = new Set((marks || []).map(
      (m) => `${m.subject_kind}|${m.subject_id}|${m.via}|${m.fact_at}`))

    const today = new Date()
    const items = []
    for (const f of facts || []) {
      const v = f.last_in_id ? vOf[f.last_in_id] : null
      // 判定并进事实行：cues.js 只认 needs_reply / not_before 两个字段，
      // 它不知道判定是从哪张表来的。**没判过就是 undefined = 当作要回。**
      const merged = v ? { ...f, needs_reply: v.needs_reply, not_before: v.not_before } : f

      const 已经在列表里 = new Set()
      for (const cue of cuesFor(merged, { today })) {
        const key = cueKey(f, cue)
        if (marked.has(key)) continue          // ✓ 或 ✕ 过的，不再出现
        已经在列表里.add(key)
        items.push({
          key, subject_kind: f.subject_kind, subject_id: f.subject_id,
          name: f.name, line_title: f.line_title, cue, verdict: v || null,
          // 这条对象的结论更新了没有。脏着 = 要么还没轮到判，要么上一轮判不出来
          // 被跳过了 —— 两种都意味着**你现在看到的可能是旧结论**，得说出来。
          // 原来判不出来是完全无声的：跳过只写进 brain 的日志，界面上一个字没有。
          stale: Boolean(f.stale),
        })
      }

      // 被判为不用回的：**不消失**，单独一层，看得见理由。
      // 判错了你自己捞得回来 —— 静默筛掉是不许的。
      if (v && v.needs_reply === false && f.last_in_at && !归了线(f)) {
        // 「放回」按下去到底会不会**多出一条**来 —— 现在就算清楚，
        // 别让按钮许一个兑现不了的承诺。
        //
        // 判定翻成「要回」再问一遍由头，然后减掉两样：已经摆在列表里的
        // （这条线可能本来就因为「发出去没回音」在上面挂着，那不算放回来），
        // 和你 ✓/✕ 过的。剩下还有的，按下去才真有东西出现。
        //
        // 减不干净的话最常见是这种：信你其实早回过了（last_out_at 晚于
        // last_in_at，球根本不在你手上），一按，这条从「不用回」里没了，
        // 上面也不会多出什么——**一条东西被按没了**，比不给这个按钮糟得多。
        const backable = cuesFor({ ...f, needs_reply: true, not_before: null }, { today })
          .some((c) => { const k = cueKey(f, c); return !marked.has(k) && !已经在列表里.has(k) })
        items.push({
          key: `${f.subject_kind}|${f.subject_id}|muted|${dayOf(f.last_in_at)}`,
          subject_kind: f.subject_kind, subject_id: f.subject_id,
          name: f.name, line_title: f.line_title, cue: null, verdict: v, backable,
        })
      }
    }

    // 还没判过的那些 —— 交给 triage() 判一批。
    //
    // **只判球真在你手上的那几封。** 一开始写成「凡是最后一封来信都判」，
    // 真跑下来四封全白判了：Kirk / Mattie / Sarah 三条你早回过了
    // （last_out_at 晚于 last_in_at），球不在你手上，那封信要不要回
    // 根本不会被问到。
    //
    // 加上这个闸之后，量锁在「此刻有几件事等你回」上——个位数，
    // 不是「你有多少个对象」（几十），更不是「你收过多少封信」（几千）。
    const 球在你手上 = (f) =>
      f.last_in_id && !归了线(f) &&
      (!f.last_out_at || new Date(f.last_out_at) <= new Date(f.last_in_at))
    const unjudged = (facts || [])
      .filter((f) => 球在你手上(f) && !vOf[f.last_in_id])
      .map((f) => f.last_in_id)

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

    return { ...layer(items, today), unjudged: [...new Set(unjudged)], stale,
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
 * 把一条「判为不用回的」放回该动的那一列。
 *
 * 判错了得捞得回来 —— 这是那一层从一开始就写着的承诺（0073 那张表的注释：
 * 「判错了你得看得见理由才捞得回来」），只是一直没有那个按钮。
 *
 * 走的是判定本身的写口 pa_judge_letter，把 needs_reply 翻成 true。
 * **不是**再存一张「用户覆盖」表：一封信要不要回只该有一个答案，
 * 两处存一件事，迟早有一处是假的。
 *
 * 原来那句判词接在后面留着 —— 覆盖掉就没人知道当初凭什么判的了。
 * 这条回到列表里之后，由头照旧从事实现算（「他回你了，N 天没回」）。
 */
export async function unmuteLetter(item) {
  const id = item?.verdict?.gmail_message_id
  if (!id) return false
  const was = item.verdict.why || '（没说理由）'
  const { data, error } = await supa.rpc('pa_judge_letter', {
    p_gmail_message_id: id, p_needs_reply: true, p_not_before: null,
    p_why: `你放回来的（原判：${was}）`,
  })
  if (error) throw new Error(error.message)
  return Boolean(data)
}

/** 都放回来 —— **只放回 ✕ 的**，真办完的不翻出来。 */
export async function unmarkAllOff() {
  const { data, error } = await supa.rpc('pa_unmark_all_off')
  if (error) throw new Error(error.message)
  return data || 0
}

/**
 * 重判一批对象：这段交流有没有约定下一个时间点、最后那封信要不要回。
 *
 * **一次判一批，量按对象数走**（几十个），不按信数（几千封）。
 * 判不成不抛 —— 水位不推进，下次打开再判，不会假装判过了。
 */
export async function rejudge(subjects) {
  if (!subjects?.length) return { judged: 0, failed: 0, touched: 0 }
  try {
    const r = await fetch(`${BRAIN}/subjects/rejudge`, {
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

/**
 * 判一批信要不要回。
 * **判不成不抛** —— 最坏是这一批当作「要回」，多吵你几条，不丢东西。
 */
export async function triage(ids) {
  if (!ids?.length) return { judged: 0, failed: 0 }
  try {
    const r = await fetch(`${BRAIN}/letters/triage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const out = await r.json().catch(() => null)
    if (!r.ok || !out || out.error) return { judged: 0, failed: ids.length }
    return out
  } catch (_) {
    return { judged: 0, failed: ids.length }
  }
}
