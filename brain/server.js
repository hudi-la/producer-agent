// Fairwind 的脑子 —— 跑在本机的 sidecar，挂 Claude 订阅（不烧 API）。
//
// 前端 POST /chat → ①你的话先落库 ②读这条线的全部往来拼成上下文
// ③交给 Agent SDK 去想（可以联网搜/读网页）④回复写回同一张表。
//
// 护栏：这个进程是唯一能写库的地方，且只写 pursuit_messages。
// Fairwind 本人只拿到 WebSearch / WebFetch —— 它碰不到数据库，改不了 stage、改不了盒子。
// 这是结构上的限制，不是嘱咐它别做。

import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { query } from '@anthropic-ai/claude-agent-sdk'

// 默认值必须和前端 backends.js 里的 BRAIN 对得上。两边默认值不一致的话，
// brain/.env 一丢，脑子听一个端口、界面敲另一个，结果是永远误报「脑子没开」。
// 改了这个文件里任何「界面依赖的行为」，就把这个日期往前挪一格，同时改
// src/lib/backends.js 里的 BRAIN_BUILD。两边对不上界面会提示你重启脑子。
//
// 为什么需要它：脑子是你手动 `npm run brain` 起的一个常驻进程。改了代码不重启，
// 它就一直跑着旧的——而界面完全看不出来。这已经害过一次：把「讲懂」改成后台扫
// 之后，前端的触发器删了、后台的扫描没跑起来，于是整整一天没有一张新卡被读过，
// 谁也没发现。和「迁移写了没跑」是同一个病。
export const BRAIN_BUILD = '2026-08-06e'

const PORT = Number(process.env.BRAIN_PORT || 8788)
const ORIGIN = process.env.BRAIN_ORIGIN || 'http://localhost:5173'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n✗ 缺配置。把 brain/.env.example 复制成 brain/.env，填上 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY。\n')
  process.exit(1)
}

// producer schema 没进 Supabase 的 Exposed schemas（共用项目，不动全局设置），
// 所以读写都走 public 里那两个 security definer 函数（见 0009_brain_rpc.sql）。
// 那两个函数只 grant 给 service_role，而且只开了「读上下文 / 写一条消息」两个口——
// Fairwind 改不了 stage、改不了盒子，是结构上做不到，不是被嘱咐别做。
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ── 上下文：Fairwind 开工前先想起这条线的一切 ──────────────────────────

async function loadContext(pursuitId) {
  const { data, error } = await db.rpc('pa_brain_context', { p_pursuit_id: pursuitId })
  if (error) throw new Error('读上下文失败：' + error.message)
  if (!data?.pursuit) throw new Error('没有这条机会线：' + pursuitId)
  return {
    p: data.pursuit,
    msgs: data.messages || [],
    entries: data.entries || [],
    profile: data.profile || null,
  }
}

async function addMessage(pursuitId, role, content, kind = 'message') {
  const { data, error } = await db.rpc('pa_add_message', {
    p_pursuit_id: pursuitId, p_role: role, p_content: content, p_kind: kind,
  })
  if (error) throw new Error(`存${role === 'artist' ? '你的话' : 'Fairwind 的回复'}失败：` + error.message)
  return data
}

const SYSTEM = `你是「 Fairwind 」，一位艺术家的 producer / 外联搭档。你服务的艺术家是 Hu Di，作品站 https://hudiworks.com/。

你的活：帮 ta 跑外联——找机会、把机会讲懂、一起挑用哪件作品、一起写申请、跟进、维护关系。

怎么做事：
- 你是**一起想的搭档，不是自动化按钮**。你提议，动手和拍板的是 ta。
- 协作弧：讲懂 → 一起挑作品 → 一起写。别跳步。
- **一次只递一件事**。别一口气抛出五个待办；挑最该现在想的那一件，把它说透。
- 你带着这条线的全部往来，所以别让 ta 重讲已经说过的事。
- 你握着 ta 的作品网和履历（下面会给），挑作品时用它，别泛泛而谈。
- 该查就查：机构背景、往届名单、申请要求、截止日期，用联网工具去核实，别猜。
- 说话像个熟悉这行的人，不是客服。中文对话；给机构的草稿按对方语言写。
- 拿不准就问 ta，别自己替 ta 决定。

你不能做的：你改不了这条线的阶段、也改不了作品盒子。要动这些，说出来让 ta 点。`

// incoming 那句刚已经落库了，所以要从「之前的往来」里摘出去（exceptId），
// 否则它会在 prompt 里出现两次。
function buildPrompt({ p, msgs, entries, profile }, incoming, exceptId) {
  const fact = (k, v) => (v ? `${k}：${v}\n` : '')
  const lines = []

  if (profile) {
    lines.push('## 关于这位艺术家')
    lines.push(JSON.stringify(profile, null, 2))
    lines.push('')
  }

  if (entries.length) {
    lines.push('## Ta 的作品与履历（战绩信息库）')
    for (const e of entries) {
      const bits = [e.year, e.medium, e.concern].filter(Boolean).join(' · ')
      lines.push(`- [${e.kind}] ${e.title}${bits ? ` (${bits})` : ''}${e.body ? ` — ${e.body}` : ''}`)
    }
    lines.push('')
  }

  lines.push('## 这条机会线')
  lines.push(
    fact('标题', p.title) + fact('机构', p.org) + fact('地点', p.location) +
    fact('类型', p.kind) + fact('资助', p.funding) + fact('截止', p.deadline) +
    fact('官方页面', p.url) + fact('当前阶段', p.stage) +
    fact('为什么可能合适', p.why) + fact('备注', p.notes) +
    (p.eligible === false ? '⚠️ 资格搁置：目前身份（O-1/绿卡限定）不满足，先别推进申请。\n' : '')
  )

  const history = msgs.filter((m) => m.id !== exceptId)
  if (history.length) {
    lines.push('## 你们之前的往来（从早到晚）')
    for (const m of history) {
      const who = m.role === 'artist' ? 'Hu Di' : m.role === 'producer' ? '你（Fairwind）' : m.role
      const tag = m.kind && m.kind !== 'message' ? `〔${m.kind}〕` : ''
      lines.push(`${who}${tag}：${m.content}`)
    }
    lines.push('')
  } else {
    lines.push('（这条线还没有往来，你们刚开始。）\n')
  }

  lines.push('## Ta 刚说')
  lines.push(incoming)
  lines.push('')
  lines.push('回应 ta。直接说话，不要写「好的，我来回应」这类前言，也不要复述上面的资料。')
  return lines.join('\n')
}

// 「讲懂」：新卡进来，Fairwind 去官方渠道核实并写一段大致了解。
function buildBriefPrompt({ p, entries, profile }) {
  const fact = (k, v) => (v ? `${k}：${v}\n` : '')
  const lines = []

  if (profile) {
    lines.push('## 关于这位艺术家')
    lines.push(JSON.stringify(profile, null, 2))
    lines.push('')
  }
  if (entries.length) {
    lines.push('## Ta 的作品与履历（战绩信息库）')
    for (const e of entries) {
      const bits = [e.year, e.medium, e.concern].filter(Boolean).join(' · ')
      lines.push(`- [${e.kind}] ${e.title}${bits ? ` (${bits})` : ''}${e.body ? ` — ${e.body}` : ''}`)
    }
    lines.push('')
  }

  lines.push('## 要讲懂的机会（卡上现有信息，可能不全或过时）')
  lines.push(
    fact('标题', p.title) + fact('机构', p.org) + fact('地点', p.location) +
    fact('类型', p.kind) + fact('资助', p.funding) + fact('截止（未必准）', p.deadline) +
    fact('已有链接', p.url) + fact('来源', p.source) + fact('备注', p.notes)
  )
  lines.push('')
  lines.push(`## 你的任务：把这个机会「讲懂」
去官方渠道核实（用 WebSearch / WebFetch，别猜）：
1. 这一届/这一轮是不是真的开放？找到官方页面。
2. 真实截止日期——聚合站上的常是上一届残留，以官方为准。
3. 申请要什么（材料、流程）。
4. 有没有国籍 / 居留 / 工作权限制——对照这位艺术家的身份（美国 O-1，常住 LA / 湾区）。ta 能不能申？
5. 跟 ta 的作品和方向契合吗？值不值得投？

然后用简洁中文写一段「讲懂」给 ta 看——像个熟这行的搭档在讲，不是复述资料。一次只递这一件事：说清楚"这机会到底是什么、关键事实、能不能申、值不值得"，最后给一句"要不要批准往下走"。别写前言。

写完，另起一行，在**最后只输出一行**机器读的事实（查不到就填 null，绝不编造）：
[[FACTS]]{"url":"官方页面URL或null","deadline":"截止的原文或null","deadline_at":"YYYY-MM-DD或null","opens_at":"YYYY-MM-DD或null","eligible":true或false}

关于这几个日期：
- deadline 填**官方的原话**（"March 15, 2027"、"spring 2027"、"rolling" 都照抄）
- deadline_at 只在能定到具体某一天时才填；"spring 2027" 这种定不下来就填 null，别猜一个
- opens_at 是**开始接受申请**的日子。已经开放了就填 null——已经开的门不用再报开门时间`)
  return lines.join('\n')
}

// 从 Fairwind 的回复尾部摘出机器读的事实行，并把它从展示文本里去掉。
function extractFacts(text) {
  const m = text.match(/\[\[FACTS\]\]\s*(\{[\s\S]*?\})\s*$/)
  if (!m) return { clean: text.trim(), facts: null }
  let facts = null
  try { facts = JSON.parse(m[1]) } catch (_) { facts = null }
  return { clean: text.slice(0, m.index).trim(), facts }
}

// ── 想 ──────────────────────────────────────────────────────

async function think(prompt) {
  const out = []
  let usage = null
  for await (const m of query({
    prompt,
    options: {
      systemPrompt: SYSTEM,          // 完全自定义人格，不加载 Claude Code 那套编码 prompt
      allowedTools: ['WebSearch', 'WebFetch'],  // 只给读网页的能力，碰不到文件和数据库
      permissionMode: 'bypassPermissions',      // 无人值守；工具面只读，安全
      maxTurns: 20,
    },
  })) {
    if (m.type === 'assistant') {
      for (const b of m.message.content) if (b.type === 'text') out.push(b.text)
    }
    if (m.type === 'result') {
      usage = { ms: m.duration_ms, turns: m.num_turns, subtype: m.subtype }
      if (m.subtype !== 'success') throw new Error('Fairwind 没想完：' + m.subtype)
    }
  }
  const text = out.join('\n').trim()
  if (!text) throw new Error('Fairwind 没说话（空回复）')
  return { text, usage }
}

// ── HTTP ────────────────────────────────────────────────────

async function handleChat(body) {
  const { pursuit_id, text } = body
  if (!pursuit_id || !text?.trim()) throw new Error('要有 pursuit_id 和 text')

  // 先落库：哪怕后面想崩了，你说的话也不会丢
  const mine = await addMessage(pursuit_id, 'artist', text.trim())

  const ctx = await loadContext(pursuit_id)
  console.log(`  ↳ 上下文：${ctx.msgs.length} 条往来 / ${ctx.entries.length} 条信息库`)
  const { text: reply, usage } = await think(buildPrompt(ctx, text.trim(), mine.id))
  console.log(`  ↳ Fairwind 想完了：${usage.turns} 轮 / ${(usage.ms / 1000).toFixed(1)}s`)

  const theirs = await addMessage(pursuit_id, 'producer', reply)
  return { mine, reply: theirs }
}

// 用户移卡：改这条线的阶段。这是「你」的动作，不是 Fairwind 的——Fairwind 只有 WebSearch/WebFetch，
// 到不了这个入口。用同一个 service_role，但只调 pa_set_stage（只能改 stage）。
async function handleStage(body) {
  const { pursuit_id, stage } = body
  if (!pursuit_id || !stage) throw new Error('要有 pursuit_id 和 stage')
  const { error } = await db.rpc('pa_set_stage', { p_pursuit_id: pursuit_id, p_stage: stage })
  if (error) throw new Error('改阶段失败：' + error.message)
  return { ok: true, pursuit_id, stage }
}

// 用户手动标「球在谁那边」：me = 待处理 / them = 等回复 / null = 回到自动判断。
// 同样只是「你」的动作——Fairwind 够不到这个口，它只有 WebSearch/WebFetch。
async function handleBall(body) {
  const { pursuit_id, ball } = body
  if (!pursuit_id) throw new Error('要有 pursuit_id')
  if (ball != null && ball !== 'me' && ball !== 'them') throw new Error('ball 只能是 me / them / null')
  const { error } = await db.rpc('pa_set_ball', { p_pursuit_id: pursuit_id, p_ball: ball ?? null })
  if (error) throw new Error('改球权失败：' + error.message)
  return { ok: true, pursuit_id, ball: ball ?? null }
}

// 讲懂：Fairwind 去官方渠道核实，写一段 brief 进这条线，并把核实到的
// 链接/截止/资格回填到卡上。幂等——已经有 brief 就不重做。
async function handleBrief(body) {
  const { pursuit_id } = body
  if (!pursuit_id) throw new Error('要有 pursuit_id')

  const ctx = await loadContext(pursuit_id)
  const existing = ctx.msgs.find((m) => m.kind === 'brief')
  if (existing) return { brief: existing, skipped: true }

  const { text, usage } = await think(buildBriefPrompt(ctx))
  const { clean, facts } = extractFacts(text)

  // 日期只认 YYYY-MM-DD。模型偶尔会把 "spring 2027" 塞进日期字段，
  // 那种塞进 date 列会直接报错——挡在这儿，宁可不填。
  const asDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

  if (facts && (facts.url || facts.deadline || facts.deadline_at || facts.opens_at ||
                typeof facts.eligible === 'boolean')) {
    const { error } = await db.rpc('pa_set_fields', {
      p_pursuit_id: pursuit_id,
      p_url: facts.url || null,
      p_deadline: facts.deadline || null,
      p_eligible: typeof facts.eligible === 'boolean' ? facts.eligible : null,
      p_opens_at: asDate(facts.opens_at),
      p_deadline_at: asDate(facts.deadline_at),
    })
    if (error) console.warn('  ⚠️ 回填字段失败：' + error.message)
    else console.log(`  ↳ 回填：${JSON.stringify(facts)}`)
  }

  const brief = await addMessage(pursuit_id, 'producer', clean, 'brief')
  return { brief, facts, usage }
}

// ── 更新最新信息：收信 → （收到了才）消化 ─────────────────────
//
// 只消化事实，不主动巡逻：added=0 就一个字不写。
// 在没变化的线上编一句凑数的话，哪怕只发生一次，这个按钮就不可信了。
//
// 消化 = 两问：① 新信让现在的待办作废了吗 ② 现在该干什么。
// 答案落库走 0029 的两个口子——闸在库里（你的活待办拒绝覆盖、
// 作废必须指认哪封信），prompt 只是第一道，不是唯一一道。
async function handleRefresh(body) {
  const { pursuit_id } = body
  if (!pursuit_id) throw new Error('要有 pursuit_id')

  const sync = await handleSync({ pursuit_id })
  if (!sync.added) {
    // 没有新信 = 没有新事实 = 不惊动任何东西
    return { ...sync, voided: false, proposed: false }
  }

  // 重新拉上下文——刚收的信要在里面。
  // loadContext 返回的键叫 p（不是 pursuit）；0029 之后 pa_brain_context 的
  // select p.* 自动带上三列新字段，msgs 是整行（含库内 id）。
  const ctx = await loadContext(pursuit_id)
  const p = ctx.p
  const fresh = ctx.msgs.filter((m) => m.kind === 'email').slice(-sync.added - 3)
  const cur = p.next_action && !p.next_action_done_at && !p.next_action_void_at
    ? p.next_action : null

  const { text } = await think(
    `这条机会线刚收到 ${sync.added} 封新信。两个问题，只答有依据的：

【现在卡上的待办】${cur ? `「${cur}」` : '（没有）'}
【近期往来（含新信）】
${fresh.map((m) => `${m.created_at?.slice(0, 10) || '?'} ${m.role === 'artist' ? 'HuDi' : (m.meta?.from_name || '对方')}：${m.content}`).join('\n')}
【截止】${p.deadline_at || p.deadline || '无'}　【该碰日】${p.next_touch_at || '无'}

问题一：新信有没有让卡上那条待办**过期**？（比如「没回就催」而对方回了。）
过期了就指认是哪封信，说一句人话的理由。没过期、或根本没待办，就 null。

问题二：读完新信，这条线**现在**该干什么？必须能指着某封信或某个日期说出依据。
说不出依据就 null——宁可不说，也不猜。凑数的话比空着更坏。
如果该干的事有明确日子（比如信里约了 8/12 回复），给 touch 一个 YYYY-MM-DD。

**最后一行**单独输出，别的什么都不要加：
[[DIGEST]] {"void": {"msg_id": "<作废依据那封信的库内 id，从上面往来里没有就用最新那封的 gmail id 对应行>", "reason": "…"} | null, "next": {"action": "一句话，20 字内", "basis": "依据（哪封信/哪个日期）", "touch": "YYYY-MM-DD 或 null"} | null}`,
    READ_TOOLS,
  )

  const m = text.match(/\[\[DIGEST\]\]\s*(\{[\s\S]*\})\s*$/)
  let digest = null
  try { digest = m ? JSON.parse(m[1]) : null } catch (_) { digest = null }
  if (!digest) {
    // 消化失败不吞掉收信成果——信已经在库里了，只是没消化。说实话。
    return { ...sync, voided: false, proposed: false, note: '信收下了，但这次没消化成（格式不对）' }
  }

  let voided = false
  if (digest.void?.reason) {
    // msg_id 由库校验（必须是这条线上的消息）。模型给的 id 不可靠时，
    // 退回「这次新收的最后一封」——作废的依据就是这批新信。
    const fallback = ctx.msgs.filter((x) => x.kind === 'email').at(-1)?.id || null
    const msgId = ctx.msgs.some((x) => x.id === digest.void.msg_id) ? digest.void.msg_id : fallback
    const { data } = await db.rpc('pa_void_next_action', {
      p_pursuit_id: pursuit_id, p_msg_id: msgId, p_reason: digest.void.reason,
    })
    voided = Boolean(data?.voided)
    if (voided) await addMessage(pursuit_id, 'producer',
      `卡上那条「${cur}」作废了——${digest.void.reason}`)
  }

  let proposed = false
  if (digest.next?.action && digest.next?.basis) {   // 没依据的提案连库都不碰
    const { data } = await db.rpc('pa_propose_next_action', {
      p_pursuit_id: pursuit_id,
      p_action: digest.next.action,
      p_touch: digest.next.touch || null,
    })
    proposed = Boolean(data?.written)
    if (proposed) await addMessage(pursuit_id, 'producer',
      `我看下一步该：${digest.next.action}（依据：${digest.next.basis}）——不对就改掉，认了就勾。`)
  }

  // touch = 提案自带的行动日。前端拿它判断「现在就能动」还是「到日子再说」——
  // 带未来日子的提案只写卡不进队（Paperbark 那次 8-6 就吵 8-12 的事，就是缺这个）。
  return { ...sync, voided, proposed, touch: (proposed && digest.next?.touch) || null }
}

// ── 后台先读 ───────────────────────────────────────────────────
// 「待批准」这个列名承诺的是「 Fairwind 已经读透了，就等你点头」。所以读这件事
// 不能等你点开卡才现做——脑子自己扫，卡进来就读，你看见它时 brief 已在库里。
//
// handleBrief 本来就幂等（有 brief 就 skipped），所以重复扫是安全的；
// briefed 只是省掉那次白跑的 loadContext，不是正确性的依赖。
const SWEEP_MS = Number(process.env.BRAIN_SWEEP_MS || 60_000)
const briefed = new Set()
const failed = new Map()        // 卡 id → 连续失败次数，用来退避
let sweeping = false
let sweeps = 0

async function sweepBriefs() {
  if (sweeping) return          // 上一轮还在读（联网研究一张要 30–60 秒），跳过这次
  sweeping = true
  sweeps++
  try {
    const { data, error } = await db
      .from('v_pa_pursuits')
      .select('id, title')
      .eq('stage', 'pending')
      .order('created_at')
    if (error) { console.warn('⚠️ 扫待批准失败：' + error.message); return }

    for (const p of data || []) {
      if (briefed.has(p.id)) continue
      // 一直失败的卡不能每分钟重试一次——那会没完没了地烧订阅额度，
      // 而且日志被同一条报错刷屏，真问题反而看不见。失败一次退避一轮。
      const n = failed.get(p.id) || 0
      if (n > 0 && sweeps % Math.min(2 ** n, 60) !== 0) continue
      try {
        const { skipped } = await handleBrief({ pursuit_id: p.id })
        briefed.add(p.id)
        failed.delete(p.id)
        if (!skipped) console.log(`  ✓ 读透了：${p.title}`)
      } catch (err) {
        failed.set(p.id, n + 1)
        console.warn(`  ⚠️ 读「${p.title}」失败（第 ${n + 1} 次）：${err.message}`)
      }
    }
  } finally {
    sweeping = false
  }
}

const send = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

// 浏览器眼里 localhost 和 127.0.0.1 是两个源，端口变了也是另一个源。
// 这是个只听本机的进程，所以本机来的一律放行 —— 省得为这个反复调 BRAIN_ORIGIN。
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
const allowOrigin = (o) => (o && (LOCAL.test(o) || o === ORIGIN) ? o : ORIGIN)

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  res.setHeader('access-control-allow-origin', allowOrigin(origin))
  res.setHeader('vary', 'origin')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS')
  if (origin && !LOCAL.test(origin) && origin !== ORIGIN) {
    console.warn(`⚠️ 拦下一个外部来源：${origin}`)
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, build: BRAIN_BUILD })

  if (req.method === 'POST' && req.url === '/chat') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}')
        console.log(`\n→ ${new Date().toLocaleTimeString('zh-CN')} 来自 ${origin || '(无 origin)'}`)
        console.log(`  ${String(body.text).slice(0, 50)}`)
        send(res, 200, await handleChat(body))
      } catch (err) {
        console.error('✗', err.message)
        send(res, 500, { error: err.message })
      }
    })
    return
  }

  if (req.method === 'POST' && req.url === '/stage') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}')
        console.log(`\n→ 移卡 ${body.pursuit_id} → ${body.stage}`)
        send(res, 200, await handleStage(body))
      } catch (err) {
        console.error('✗', err.message)
        send(res, 500, { error: err.message })
      }
    })
    return
  }

  if (req.method === 'POST' && req.url === '/ball') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}')
        console.log(`\n→ 球权 ${body.pursuit_id} → ${body.ball ?? '自动'}`)
        send(res, 200, await handleBall(body))
      } catch (err) {
        console.error('✗', err.message)
        send(res, 500, { error: err.message })
      }
    })
    return
  }

  if (req.method === 'POST' && req.url === '/brief') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}')
        console.log(`\n→ ${new Date().toLocaleTimeString('zh-CN')} 讲懂 ${body.pursuit_id}`)
        send(res, 200, await handleBrief(body))
      } catch (err) {
        console.error('✗', err.message)
        send(res, 500, { error: err.message })
      }
    })
    return
  }

  if (req.method === 'POST' && (req.url === '/gmail-draft' || req.url === '/sync' || req.url === '/refresh')) {
    const isDraft = req.url === '/gmail-draft'
    const isRefresh = req.url === '/refresh'
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}')
        console.log(`\n→ ${new Date().toLocaleTimeString('zh-CN')} ${isDraft ? '放草稿箱' : isRefresh ? '更新' : '收信'} ${body.pursuit_id}`)
        const out = isDraft ? await handleGmailDraft(body) : isRefresh ? await handleRefresh(body) : await handleSync(body)
        console.log(`  ↳ ${JSON.stringify(out)}`)
        send(res, 200, out)
      } catch (err) {
        console.error('✗', err.message)
        send(res, 500, { error: err.message })
      }
    })
    return
  }

  send(res, 404, { error: 'not found' })
})

server.listen(PORT, () => {
  console.log(`\n🔥 Fairwind 的脑子醒着  http://localhost:${PORT}`)
  console.log(`   放行来源：${ORIGIN}`)
  console.log(`   后台先读：每 ${Math.round(SWEEP_MS / 1000)} 秒扫一次「待批准」`)
  console.log(`   计费：走你的 Claude 订阅用量（没用 API key）\n`)
  sweepBriefs()
  setInterval(sweepBriefs, SWEEP_MS)
})
