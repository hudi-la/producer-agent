// 分工：
//  · 读 + 「你自己改自己卡上的字段」(stage / ball) —— 浏览器直连，走 anon。
//    后者靠 security definer 函数，能改的列是写死的，anon 拿不到别的写权限。
//  · 「 Fairwind 去想」(chat / brief) —— 走本机 sidecar，因为那需要 service_role
//    往往来历史里写消息，且要跑 agent。
import { supa, BRAIN } from './backends.js'

/** 拉这条机会线最新的往来。没连库时返回 null（保留调用方手上的种子数据）。 */
export async function fetchMessages(pursuitId) {
  if (!supa) return null
  const { data, error } = await supa
    .from('v_pa_pursuit_messages')
    .select('*')
    .eq('pursuit_id', pursuitId)
    .order('created_at')
  if (error) return null
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
  if (error) return null
  return data
}

/**
 * 说一句话给 Fairwind 。你的话先落库，然后等它想完 —— 联网查资料时可能要几十秒。
 *
 * meta 记的是「你这句是怎么发出来的」（比如群发），只贴在你那条消息上。
 * 不传就完全不带这个键，走 RPC 的默认值 —— 单发的调用方一个字都不用改。
 */
export async function sendMessage(pursuitId, text, meta) {
  let res
  try {
    res = await fetch(`${BRAIN}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pursuit_id: pursuitId, text, ...(meta ? { meta } : {}) }),
    })
  } catch (_) {
    throw new Error('Fairwind 的脑子没开 —— 另开一个终端跑 npm run brain')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `脑子出错了（${res.status}）`)
  return body
}

// 「讲懂」没有前端入口了：脑子自己在后台扫「新机会里还没读的卡」去读，
// 你点开卡时 brief 已经在库里。sidecar 那边的 POST /brief 还留着（手动补一张时用）。

// ── 你自己的动作：不经过 sidecar ────────────────────────────────
// 打标签、拖卡片是你在整理自己的看板，跟 AI 想不想得动没关系。这两个走
// security definer 函数直连数据库——只能改 stage / ball 两列，别的碰不到。
// 好处：sidecar 开不开、是不是最新的，都不影响你整理看板。

/**
 * 改「球在谁那边」那个标：'me' 待处理 / 'them' 等回复（null 是给 Fairwind 留的，
 * 界面上没有这个选项）。写进去的同时库里盖一个时间戳 ball_at ——
 * 之后来了新信号（对外通信、跟进日到期），Fairwind 就重新接管这个标。
 * 最终显示哪个由视图算（ball_eff），这里只负责写。
 */
export async function setBall(pursuitId, ball) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
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
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { error } = await supa.rpc('pa_set_action_done', { p_pursuit_id: pursuitId, p_done: done })
  if (error) throw new Error(error.message)
  return { ok: true, done }
}

/** 卡上随手记的几个字。传空字符串 = 清掉。 */
export async function setJot(pursuitId, jot) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { error } = await supa.rpc('pa_set_jot', { p_pursuit_id: pursuitId, p_jot: jot ?? '' })
  if (error) throw new Error(error.message)
  return { ok: true }
}

/** 「碰过了」：记下今天碰的，并把待碰日清掉。没有撤销。 */
export async function markTouched(pursuitId) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
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
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { error } = await supa.rpc('pa_set_stage', { p_pursuit_id: pursuitId, p_stage: stage })
  if (error) throw new Error(error.message)
  return { ok: true, stage }
}
