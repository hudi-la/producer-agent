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

/** 说一句话给 Fairwind 。你的话先落库，然后等它想完 —— 联网查资料时可能要几十秒。 */
export async function sendMessage(pursuitId, text) {
  let res
  try {
    res = await fetch(`${BRAIN}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pursuit_id: pursuitId, text }),
    })
  } catch (_) {
    throw new Error('Fairwind 的脑子没开 —— 另开一个终端跑 npm run brain')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `脑子出错了（${res.status}）`)
  return body
}

// 「讲懂」没有前端入口了：脑子自己在后台扫「待批准里还没读的卡」去读，
// 你点开卡时 brief 已经在库里。sidecar 那边的 POST /brief 还留着（手动补一张时用）。

// ── 你自己的动作：不经过 sidecar ────────────────────────────────
// 打标签、拖卡片是你在整理自己的看板，跟 AI 想不想得动没关系。这两个走
// security definer 函数直连数据库——只能改 stage / ball 两列，别的碰不到。
// 好处：sidecar 开不开、是不是最新的，都不影响你整理看板。

/**
 * 手动标「球在谁那边」：'me' 待处理 / 'them' 等回复 / null 回到自动判断。
 * 自动判断在库的视图里算（ball_auto），这里只写手动覆盖。
 */
export async function setBall(pursuitId, ball) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { error } = await supa.rpc('pa_set_ball', { p_pursuit_id: pursuitId, p_ball: ball ?? null })
  if (error) throw new Error(error.message)
  return { ok: true, ball: ball ?? null }
}

/** 移卡：改这条线的阶段。 */
export async function setStage(pursuitId, stage) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { error } = await supa.rpc('pa_set_stage', { p_pursuit_id: pursuitId, p_stage: stage })
  if (error) throw new Error(error.message)
  return { ok: true, stage }
}
