// 渡的脑子 —— 跑在本机的 sidecar，挂 Claude 订阅（不烧 API）。
//
// 前端 POST /chat → ①你的话先落库 ②读这条线的全部往来拼成上下文
// ③交给 Agent SDK 去想（可以联网搜/读网页）④回复写回同一张表。
//
// 护栏：这个进程是唯一能写库的地方，且只写 pursuit_messages。
// 渡本人只拿到 WebSearch / WebFetch —— 它碰不到数据库，改不了 stage、改不了盒子。
// 这是结构上的限制，不是嘱咐它别做。

import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { query } from '@anthropic-ai/claude-agent-sdk'

// 默认值必须和前端 backends.js 里的 BRAIN 对得上。两边默认值不一致的话，
// brain/.env 一丢，脑子听一个端口、界面敲另一个，结果是永远误报「脑子没开」。
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
// 渡改不了 stage、改不了盒子，是结构上做不到，不是被嘱咐别做。
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ── 上下文：渡开工前先想起这条线的一切 ──────────────────────────

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
  if (error) throw new Error(`存${role === 'artist' ? '你的话' : '渡的回复'}失败：` + error.message)
  return data
}

const SYSTEM = `你是「渡」，一位艺术家的 producer / 外联搭档。你服务的艺术家是 Hu Di，作品站 https://hudiworks.com/。

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
      const who = m.role === 'artist' ? 'Hu Di' : m.role === 'producer' ? '你（渡）' : m.role
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

// 「讲懂」：新卡进来，渡去官方渠道核实并写一段大致了解。
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
[[FACTS]]{"url":"官方页面URL或null","deadline":"YYYY-MM-DD或null","eligible":true或false}`)
  return lines.join('\n')
}

// 从渡的回复尾部摘出机器读的事实行，并把它从展示文本里去掉。
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
      if (m.subtype !== 'success') throw new Error('渡没想完：' + m.subtype)
    }
  }
  const text = out.join('\n').trim()
  if (!text) throw new Error('渡没说话（空回复）')
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
  console.log(`  ↳ 渡想完了：${usage.turns} 轮 / ${(usage.ms / 1000).toFixed(1)}s`)

  const theirs = await addMessage(pursuit_id, 'producer', reply)
  return { mine, reply: theirs }
}

// 用户移卡：改这条线的阶段。这是「你」的动作，不是渡的——渡只有 WebSearch/WebFetch，
// 到不了这个入口。用同一个 service_role，但只调 pa_set_stage（只能改 stage）。
async function handleStage(body) {
  const { pursuit_id, stage } = body
  if (!pursuit_id || !stage) throw new Error('要有 pursuit_id 和 stage')
  const { error } = await db.rpc('pa_set_stage', { p_pursuit_id: pursuit_id, p_stage: stage })
  if (error) throw new Error('改阶段失败：' + error.message)
  return { ok: true, pursuit_id, stage }
}

// 用户手动标「球在谁那边」：me = 待处理 / them = 等回复 / null = 回到自动判断。
// 同样只是「你」的动作——渡够不到这个口，它只有 WebSearch/WebFetch。
async function handleBall(body) {
  const { pursuit_id, ball } = body
  if (!pursuit_id) throw new Error('要有 pursuit_id')
  if (ball != null && ball !== 'me' && ball !== 'them') throw new Error('ball 只能是 me / them / null')
  const { error } = await db.rpc('pa_set_ball', { p_pursuit_id: pursuit_id, p_ball: ball ?? null })
  if (error) throw new Error('改球权失败：' + error.message)
  return { ok: true, pursuit_id, ball: ball ?? null }
}

// 讲懂：渡去官方渠道核实，写一段 brief 进这条线，并把核实到的
// 链接/截止/资格回填到卡上。幂等——已经有 brief 就不重做。
async function handleBrief(body) {
  const { pursuit_id } = body
  if (!pursuit_id) throw new Error('要有 pursuit_id')

  const ctx = await loadContext(pursuit_id)
  const existing = ctx.msgs.find((m) => m.kind === 'brief')
  if (existing) return { brief: existing, skipped: true }

  const { text, usage } = await think(buildBriefPrompt(ctx))
  const { clean, facts } = extractFacts(text)

  if (facts && (facts.url || facts.deadline || typeof facts.eligible === 'boolean')) {
    const { error } = await db.rpc('pa_set_fields', {
      p_pursuit_id: pursuit_id,
      p_url: facts.url || null,
      p_deadline: facts.deadline || null,
      p_eligible: typeof facts.eligible === 'boolean' ? facts.eligible : null,
    })
    if (error) console.warn('  ⚠️ 回填字段失败：' + error.message)
    else console.log(`  ↳ 回填：${JSON.stringify(facts)}`)
  }

  const brief = await addMessage(pursuit_id, 'producer', clean, 'brief')
  return { brief, facts, usage }
}

// ── 后台先读 ───────────────────────────────────────────────────
// 「待批准」这个列名承诺的是「渡已经读透了，就等你点头」。所以读这件事
// 不能等你点开卡才现做——脑子自己扫，卡进来就读，你看见它时 brief 已在库里。
//
// handleBrief 本来就幂等（有 brief 就 skipped），所以重复扫是安全的；
// briefed 只是省掉那次白跑的 loadContext，不是正确性的依赖。
const SWEEP_MS = Number(process.env.BRAIN_SWEEP_MS || 60_000)
const briefed = new Set()
let sweeping = false

async function sweepBriefs() {
  if (sweeping) return          // 上一轮还在读（联网研究一张要 30–60 秒），跳过这次
  sweeping = true
  try {
    const { data, error } = await db
      .from('v_pa_pursuits')
      .select('id, title')
      .eq('stage', 'pending')
      .order('created_at')
    if (error) { console.warn('⚠️ 扫待批准失败：' + error.message); return }

    for (const p of data || []) {
      if (briefed.has(p.id)) continue
      try {
        const { skipped } = await handleBrief({ pursuit_id: p.id })
        briefed.add(p.id)
        if (!skipped) console.log(`  ✓ 读透了：${p.title}`)
      } catch (err) {
        console.warn(`  ⚠️ 读「${p.title}」失败：${err.message}`)   // 不记进 briefed，下轮重试
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

  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true })

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

  send(res, 404, { error: 'not found' })
})

server.listen(PORT, () => {
  console.log(`\n🔥 渡的脑子醒着  http://localhost:${PORT}`)
  console.log(`   放行来源：${ORIGIN}`)
  console.log(`   后台先读：每 ${Math.round(SWEEP_MS / 1000)} 秒扫一次「待批准」`)
  console.log(`   计费：走你的 Claude 订阅用量（没用 API key）\n`)
  sweepBriefs()
  setInterval(sweepBriefs, SWEEP_MS)
})
