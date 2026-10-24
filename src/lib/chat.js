import { reportError } from './reportError.js'
import { errorText } from './userError.js'
// 分工：
//  · 读 + 「你自己改自己卡上的字段」(stage / ball) —— 浏览器直连，走 anon。
//    后者靠 security definer 函数，能改的列是写死的，anon 拿不到别的写权限。
//  · 「 Fairwind 去想」(chat / brief) —— 走本机 sidecar，因为那需要 service_role
//    往往来历史里写消息，且要跑 agent。
import { supa, BRAIN, brainFetch } from './backends.js'
import { frameSplitter, frameData } from './sse.js'
import { t } from '../i18n/index.js'

/** 拉这条机会线最新的往来。没连库时返回 null（保留调用方手上的种子数据）。 */
export async function fetchMessages(pursuitId) {
  if (!supa) return null
  // v_pa_pursuit_thread 而不是 v_pa_pursuit_messages：
  //
  // **很多信是靠班底 / 串登记推导挂到线上的**，pursuit_id 是空的
  // （v_pa_pursuit_mail.on_this_line）。按 pursuit_id 读的话，
  // ASU 那条线 16 封信一封都读不到 —— 数过，12 条有信的线里只有 1 条读得全，
  // 一共 49 封在对话里看不见。
  //
  // 事实视图（v_pa_cue_facts）和重判（pa_subjects_for_rejudge）都已经走推导，
  // 这儿是第三处，也是最后一处。见 0086。
  const { data, error } = await supa
    .from('v_pa_pursuit_thread')
    .select('*')
    .eq('pursuit_id', pursuitId)
    .order('created_at')
  if (error) { reportError(error, t('读取数据失败')); return null }
  return data
}

/**
 * 拉这一张卡的两段长文：why（匹配理由）和 notes（关系记忆）。
 *
 * 看板读的是 v_pa_pursuit_cards —— 那儿故意不带这两列（0115）：72 张卡
 * 每次刷新都搬一遍两段长文，占了看板下载量的一半，而卡片一个字都不显示它们。
 * 你点开哪一张，才为哪一张拉一次，一次几 KB。
 *
 * 拉不到返回 null，调用方退回 p.why / p.notes —— 没连库时那两个字段
 * 来自种子数据，那条路一个字不能断。
 */
export async function fetchPursuitDetail(pursuitId) {
  if (!supa || !pursuitId) return null
  const { data, error } = await supa
    .from('v_pa_pursuits').select('why,notes').eq('id', pursuitId).maybeSingle()
  if (error) { reportError(error, t('读取数据失败')); return null }
  return data
}

/**
 * 拉这个人名下的往来：邮件（有 gmail_message_id）+ 你记的笔（role='note'）。
 * 没连库时返回 null。
 *
 * 跟 fetchMessages 是一对：一个按线读「你跟 Fairwind 的商量」，
 * 一个按人读「跟外面的人的真实往来」。两种消息躺在同一张表里，
 * 靠 pursuit_id / contact_id 分开（见 0033 那道迁移）。
 */
export async function fetchContactMessages(contactId) {
  if (!supa) return null
  const { data, error } = await supa
    .from('v_pa_pursuit_messages')
    .select('*')
    .eq('contact_id', contactId)
    .order('created_at')
  if (error) { reportError(error, t('读取数据失败')); return null }
  return data
}

/**
 * 说一句话给 Fairwind 。你的话先落库，然后等它想完 —— 联网查资料时可能要几十秒。
 *
 * meta 记的是「你这句是怎么发出来的」（比如群发），只贴在你那条消息上。
 * 不传就完全不带这个键，走 RPC 的默认值 —— 单发的调用方一个字都不用改。
 */
/**
 * 说话的对象：机会线、人，还是档案里那张书桌。
 *
 * 传字符串 = 机会线（老调用方一个字不用改）；传 {kind,id} 三种都行。
 * brain 那边 ownerOf 收的就是这三样（server.js 的 contact_id / pursuit_id / entry_id）。
 *
 * 书桌那种的 id 是**那一条条目的 id** —— 对话挂在一条具体的东西上。
 */
export const ownerBody = (owner) =>
  typeof owner === 'string' ? { pursuit_id: owner }
    : owner?.kind === 'contact' ? { contact_id: owner.id }
      : owner?.kind === 'studio' ? { entry_id: owner.id }
        : { pursuit_id: owner?.id }

export async function sendMessage(owner, text, meta, runId) {
  let res
  try {
    res = await brainFetch(`${BRAIN}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...ownerBody(owner), text, ...(meta ? { meta } : {}), ...(runId ? { run_id: runId } : {}) }),
    })
  } catch (_) {
    throw new Error(t('服务器那边暂时没应,过一会儿刷新再试;一直这样就告诉 Hu Di。'))
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(errorText(body.error) || t('脑子出错了（{status}）', { status: res.status }))
  return body   // { mine, reply } —— 你按了终止的话 reply 是 null、带 aborted: true
}

/** 脑子还没有 /chat/stream（没重启）—— 认得出来，好退回老路子。 */
class NoStream extends Error {}

/**
 * 说一句话，边想边收字。
 *
 * 底层是 SSE，但用 fetch 手读而不是 EventSource —— 后者只会发 GET，
 * 而我们要把一整段话发过去。
 *
 * onEvent 收到的就是脑子那边发的帧：
 *   { t:'mine', row }   你那条落库了（拿它把乐观插入的临时条换成真的）
 *   { t:'tool', name }  它去动工具了（这一轮不产字，得有个交代）
 *   { t:'delta', text } 又出了一截
 * 最后返回 { mine, reply, aborted } —— 跟 sendMessage 的返回长一样，
 * 调用方两条路都能接。
 *
 * **reply 是脑子落库后发回来的正式那条，不是攒起来的 delta。** delta 只是预览，
 * 会丢会乱；进时间线的必须是库里那份。
 */
export async function streamChat(body, onEvent) {
  let res
  try {
    res = await brainFetch(`${BRAIN}/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (_) {
    throw new Error(t('服务器那边暂时没应,过一会儿刷新再试;一直这样就告诉 Hu Di。'))
  }
  if (res.status === 404) throw new NoStream()
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error(errorText(b.error) || t('脑子出错了（{status}）', { status: res.status }))
  }

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  const frames = frameSplitter()
  let mine = null, reply = null, aborted = false, err = null

  const take = (frame) => {
    const e = frameData(frame)
    if (!e) return
    if (e.t === 'mine') mine = e.row
    else if (e.t === 'done') { reply = e.reply || null; aborted = !!e.aborted }
    else if (e.t === 'error') err = errorText(e.error) + (/^[0-9a-f-]{36}$/i.test(e.requestId || '') ? ` [request:${e.requestId}]` : '')
    onEvent?.(e)
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    for (const f of frames.push(dec.decode(value, { stream: true }))) take(f)
  }
  take(frames.rest())

  // 流断在半路上（脑子挂了、网线拔了）：没有 done 帧就是没想完，
  // 不能静悄悄返回一个空回复——那看起来像它想完了但什么都没说。
  if (err) throw new Error(errorText(err))
  if (!reply && !aborted) throw new Error(t('Fairwind 那边断了 —— 再说一次让它重想'))
  return { mine, reply, aborted }
}

/**
 * 机会线上说一句，边想边出字。
 *
 * 脑子是旧的（还没有 /chat/stream）就退回原来那条路 —— 一次改动不该让
 * 没重启 brain 的人连话都说不了，只是没有流而已。
 */
export async function sendMessageStream(owner, text, meta, runId, onEvent) {
  try {
    return await streamChat(
      { ...ownerBody(owner), text, ...(meta ? { meta } : {}), ...(runId ? { run_id: runId } : {}) },
      onEvent,
    )
  } catch (e) {
    if (e instanceof NoStream) return sendMessage(owner, text, meta, runId)
    throw e
  }
}

export { NoStream }

/**
 * 「重说」：把你点的那句和它之后的对话撤掉。返回撤了几条。
 *
 * 走浏览器直连，跟 setBall / setStage 一路 —— 这是**你在整理自己的对话**，
 * 脑子开没开不该影响你撤掉自己说错的话。
 *
 * 撤掉的话库里还在（打了 deleted_at 的标），只是读面全部滤掉：界面看不见，
 * Fairwind 的 prompt 里也没有。后者才是重点 —— 不然你以为撤干净了，
 * 它却仍在按那句错话想事情。见 0066 那道迁移。
 */
export async function rewindChat(msgId) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  const { data, error } = await supa.rpc('pa_rewind_chat', { p_msg_id: msgId })
  if (error) throw new Error(error.message)
  return data ?? 0
}

/**
 * 终止某一次「Fairwind 在想」。run_id 是发起时浏览器自己生成、随 /chat 一起发过去的
 * ——不能等 /chat 返回再拿，那时候早想完了，没得停。
 *
 * 停的是它的回复，不是你的话：你那句在 /chat 一开头就落库了，留着。
 * 停不掉也不报错（可能刚好想完了，也可能脑子重启过），前端照样把界面解开。
 */
export async function stopThinking(runId) {
  if (!runId) return { ok: true, stopped: false }
  try {
    const res = await brainFetch(`${BRAIN}/chat/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run_id: runId }),
    })
    if (!res.ok) return { ok: false, stopped: false }; return await res.json().catch(() => ({ ok: false, stopped: false }))
  } catch (_) {
    return { ok: false, stopped: false }
  }
}

// 「讲懂」没有前端入口了：脑子自己在后台扫「新机会里还没读的卡」去读，
// 你点开卡时 brief 已经在库里。sidecar 那边的 POST /brief 还留着（手动补一张时用）。

// ── 你自己的动作：不经过 sidecar ────────────────────────────────
// 打标签、拖卡片是你在整理自己的看板，跟 AI 想不想得动没关系。这两个走
// security definer 函数直连数据库——只能改 stage / ball 两列，别的碰不到。
// 好处：sidecar 开不开、是不是最新的，都不影响你整理看板。

/**
 * 改「球在谁那边」那个标：'me' 待处理 / 'them' 等回复 / null 两个都不亮
 * （点已经亮着的那个 = 灭掉，传 null 进来）。
 *
 * **这个标只有你能改。** 原来库里有一套「你手动定的能撑到下一件真事发生，
 * 之后 Fairwind 重新接管」的规则——它会把你的判断悄悄改回去，而你不会收到
 * 任何通知。整套删了（0058）：系统只报事实（新来信、红点、日期），
 * 「该不该我动」是判断，判断归你。
 */
export async function setBall(pursuitId, ball) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  const { error } = await supa.rpc('pa_set_ball', { p_pursuit_id: pursuitId, p_ball: ball ?? null })
  if (error) throw new Error(error.message)
  return { ok: true, ball: ball ?? null }
}

/**
 * 勾掉 / 取消勾「下一步」。
 * 勾掉只写时间戳，next_action 的原文一个字不动——所以取消勾还能回来，
 * 详情页也仍看得到你做过这件事。
 */
export async function setActionDone(pursuitId, done) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  const { error } = await supa.rpc('pa_set_action_done', { p_pursuit_id: pursuitId, p_done: done })
  if (error) throw new Error(error.message)
  return { ok: true, done }
}

/** 卡上随手记的几个字。传空字符串 = 清掉。 */
/**
 * 「记一笔」：把一句话记成这条线上的一次真实来往（不是跟 Fairwind 商量）。
 * 电话里说定的、表单交出去的 —— 系统看不见邮箱外的事，靠你这一笔。
 * kind：note（一般）| meet（见了面）| decision（拍板了）。
 */
export async function addPursuitNote(pursuitId, text, kind = 'note') {
  if (!supa) throw new Error(t('还没连上库'))
  const { data, error } = await supa.rpc('pa_add_pursuit_note', {
    p_pursuit_id: pursuitId, p_text: text, p_kind: kind,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function setJot(pursuitId, jot) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  const { error } = await supa.rpc('pa_set_jot', { p_pursuit_id: pursuitId, p_jot: jot ?? '' })
  if (error) throw new Error(error.message)
  return { ok: true }
}

/** 「碰过了」：记下今天碰的，并把待碰日清掉。没有撤销。 */
export async function markTouched(pursuitId) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  const { error } = await supa.rpc('pa_mark_touched', { p_pursuit_id: pursuitId })
  if (error) throw new Error(error.message)
  return { ok: true }
}

/**
 * 「读到这儿了」。
 *
 * 原来这件事存在 localStorage 里，于是它只活在某一个浏览器里 —— 换个窗口、
 * 换台机器，你读过的每一条线都重新变红。它是事实，该跟卡走。
 *
 * at 传值只有一个用处：把旧的 localStorage 记录搬上来（见 App.jsx 的一次性搬迁）。
 * 平时不传 = 现在。库里那边只前进不后退，并发的标签页不会把进度往回拨。
 */
/** 这个人的卡读到哪儿了（0124）。跟机会线那份同一套：时间只前进不后退。 */
export async function markContactSeen(contactId, at = null) {
  if (!supa) return
  const { error } = await supa.rpc('pa_mark_contact_seen', { p_contact_id: contactId, p_at: at })
  if (error) throw new Error(error.message)
}

export async function markSeen(pursuitId, at = null) {
  if (!supa) return
  const { error } = await supa.rpc('pa_mark_seen', { p_pursuit_id: pursuitId, p_at: at })
  if (error) throw new Error(error.message)
}

/** 你认了 Fairwind 提的下一步：记号消失。 */
export async function acceptNextAction(pursuitId) {
  const { error } = await supa.rpc('pa_accept_next_action', { p_pursuit_id: pursuitId })
  if (error) throw new Error(error.message)
}

/** 移卡：改这条线的阶段。 */
export async function setStage(pursuitId, stage) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  const { error } = await supa.rpc('pa_set_stage', { p_pursuit_id: pursuitId, p_stage: stage })
  if (error) throw new Error(error.message)
  return { ok: true, stage }
}
