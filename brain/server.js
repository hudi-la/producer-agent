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
export const BRAIN_BUILD = '2026-08-08c'

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
    // 0027 之后上下文里还有产出和邮件线索。它们不进对话 prompt（那是另一套用法），
    // 但 /gmail-draft 和 /sync 要照着它们干活，所以整包留在这儿。
    raw: data,
  }
}

// 一次请求是给谁干活：一条机会线，还是一个人。
//
// 两个口子进来的形状一样，只是主人不同。写成一个小对象，免得每个函数各判一遍
// ——各判一遍就一定会有一处判漏，而那一处会静悄悄把信写到没有主的地方去。
function ownerOf(body) {
  if (body?.contact_id) return { kind: 'contact', id: body.contact_id }
  if (body?.pursuit_id) return { kind: 'pursuit', id: body.pursuit_id }
  return null
}
const asOwner = (x) => (x && typeof x === 'object' && x.kind ? x : { kind: 'pursuit', id: x })

// 一个人的上下文。形状跟 loadContext 一样（p / msgs / entries / profile / raw），
// 好让下面那些 prompt 一套两用——照抄两份迟早会分叉。
// p 装的是名片：prompt 里那句「这条线是什么」，对人来说就是「这个人是谁」。
async function loadPersonContext(contactId) {
  const { data, error } = await db.rpc('pa_brain_person_context', { p_contact_id: contactId })
  if (error) throw new Error('读上下文失败：' + error.message)
  if (!data?.contact) throw new Error('没有这个人：' + contactId)
  const c = data.contact
  return {
    kind: 'contact',
    p: { ...c, title: c.name || '未具名联系人' },
    msgs: data.messages || [],
    entries: data.entries || [],
    profile: data.profile || null,
    raw: data,
  }
}

async function loadOwnerContext(owner) {
  const o = asOwner(owner)
  return o.kind === 'contact'
    ? loadPersonContext(o.id)
    : { ...(await loadContext(o.id)), kind: 'pursuit' }
}

async function addMessage(owner, role, content, kind = 'message', meta = null) {
  const o = asOwner(owner)
  const { data, error } = await db.rpc(
    o.kind === 'contact' ? 'pa_add_contact_message' : 'pa_add_message',
    {
      ...(o.kind === 'contact' ? { p_contact_id: o.id } : { p_pursuit_id: o.id }),
      p_role: role, p_content: content, p_kind: kind,
      // 不传就完全不带这个键，走函数默认值（0031）——现有那几处 4 参调用一处都不用改。
      ...(meta ? { p_meta: meta } : {}),
    },
  )
  if (error) throw new Error(`存${role === 'artist' ? '你的话' : 'Fairwind 的回复'}失败：` + error.message)
  return data
}

// 「你服务的谁」是**数据**，不是常量。原来这儿写死着 "Hu Di / hudiworks.com"，
// 而同一批事实在 producer.profile 里也存着一份 —— 两份会飘，而且改的时候只有
// 开 SQL 一条路。现在只有库里那一份是真的；这里每次开工现读。
//
// 读不到就退回一句不认人的话：宁可它说"这位艺术家"，也不要它张口就叫错名字。
// 档案里没填就退回不认人的说法 —— 宁可说「这位艺术家」，也不要编一个。
const artistOf  = (profile) => profile?.name || '这位艺术家'
const idOf      = (profile) => {
  const d = profile?.data || {}
  const loc = Array.isArray(d.location) ? d.location.join(' / ') : d.location
  return [d.visa, loc && `常住 ${loc}`].filter(Boolean).join('，')
}
const mailboxOf = (profile) => profile?.data?.email || null

const systemFor = (profile) => {
  const name = profile?.name
  const site = profile?.website
  const who = name ? `你服务的艺术家是 ${name}${site ? `，作品站 ${site}` : ''}。` : ''
  return `你是「 Fairwind 」，一位艺术家的 producer / 外联搭档。${who}

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
}

// 履历那些「一条」的关键事实——学校名、机构、起止年份、地点——存在 meta 这个
// jsonb 里，不是表上的列。所以这里必须按 kind 摊开：不摊，education / credit / job
// 在 prompt 里就只剩一个光秃秃的标题，Fairwind 会如实汇报「你档案里没有这些」，
// 而界面上明明白白写着。（这已经害过一次：它跟 Hu Di 说「教育那栏空得有点厉害」。）
//
// 界面上那份对应实现是 src/data/entriesSeed.js 的 subInfo()——改一边记得改另一边。
// 故意没有共用一份：brain 是独立进程，import 前端源码会连 57 条种子数据一起拖进来；
// 而且两边需求不同（见下面 credit 那条）。
function entryFacts(e) {
  const m = e.meta || {}
  const keep = (xs) => xs.filter((x) => x && x !== '（待补）')
  const period = keep([m.start, m.end]).join(' – ')
  switch (e.kind) {
    case 'education': return keep([m.school, m.year, m.location])
    case 'job':       return keep([m.org, period, m.location])
    case 'credit':    return keep([m.org, m.year, m.location])
    case 'statement': return keep([m.scope])
    default:          return []                // work / skill / offer 的事实在真列上
  }
}

// 「战绩信息库」那一段。chat 和 brief 两条路都用它——本来是两份一模一样的复制，
// 漏改一份就是一条路瞎、另一条路不瞎，最难查。
function entriesBlock(entries) {
  if (!entries.length) return []
  const lines = ['## Ta 的作品与履历（战绩信息库）']
  for (const e of entries) {
    // credit 的「个展 / 群展 / 驻地 / grant / 策展」在界面上是分组标题，prompt 里
    // 没有分组，所以要挂到 kind 标签上——不然它分不出这是个展还是群展。
    const label = e.kind === 'credit' && e.meta?.type ? `credit · ${e.meta.type}` : e.kind
    const bits = [e.year, e.medium, e.concern, ...entryFacts(e)].filter(Boolean).join(' · ')
    const tags = e.tags?.length ? `〔标签：${e.tags.join(' / ')}〕` : ''
    lines.push(`- [${label}] ${e.title}${bits ? ` (${bits})` : ''}${e.body ? ` — ${e.body}` : ''}${tags}`)
  }
  lines.push('')
  return lines
}

// incoming 那句刚已经落库了，所以要从「之前的往来」里摘出去（exceptId），
// 否则它会在 prompt 里出现两次。
function buildPrompt({ p, msgs, entries, profile, kind }, incoming, exceptId) {
  const fact = (k, v) => (v ? `${k}：${v}\n` : '')
  const lines = []

  if (profile) {
    lines.push('## 关于这位艺术家')
    lines.push(JSON.stringify(profile, null, 2))
    lines.push('')
  }

  lines.push(...entriesBlock(entries))

  // 一个人和一条机会线是两种东西：线有阶段和截止推着，人只有「你们是什么关系」。
  // 所以这一段分岔，往来那一段以下完全共用。
  if (kind === 'contact') {
    lines.push('## 这个人')
    lines.push(
      fact('名字', p.name) + fact('机构', p.org) + fact('他管什么', p.role) +
      fact('邮箱', p.email) + fact('谁介绍的', p.intro_by_name) +
      fact('上次碰', p.last_touch_at && `${p.last_touch_at}（${
        { email: '来自那封信', checkin: '你打的卡', meet: '你记的一笔' }[p.last_touch_src] || '来源不明'}）`) +
      fact('说好什么时候再碰', p.next_touch_at && `${p.next_touch_at}${p.next_touch_why ? ` —— ${p.next_touch_why}` : ''}`) +
      fact('关系记忆', p.notes) +
      fact('他挂着的机会线', (p.pursuits || []).map((x) => x.title).join('、'))
    )
    lines.push('')
    lines.push('写给他的信按对方语言写。**别写纯问候**——在美国，「just checking in」/「hope you\'re well」' +
               '是公认最没用的邮件。每一封都得带一个由头：有新作品 / 看到个东西想到他 / 要去他的城市 / 恭喜他那个展。')
    lines.push('')
  } else {
    lines.push('## 这条机会线')
    lines.push(
      fact('标题', p.title) + fact('机构', p.org) + fact('地点', p.location) +
      fact('类型', p.kind) + fact('资助', p.funding) + fact('截止', p.deadline) +
      fact('官方页面', p.url) + fact('当前阶段', p.stage) +
      fact('为什么可能合适', p.why) + fact('备注', p.notes) +
      (p.eligible === false
        ? `⚠️ 资格搁置：目前身份${idOf(profile) ? `（${idOf(profile)}）` : ''}不满足这条线的要求，先别推进申请。\n`
        : '')
    )
  }

  const history = msgs.filter((m) => m.id !== exceptId)
  if (history.length) {
    lines.push('## 你们之前的往来（从早到晚）')
    for (const m of history) {
      const who = m.role === 'artist' ? artistOf(profile) : m.role === 'producer' ? '你（Fairwind）' : m.role
      const tag = m.kind && m.kind !== 'message' ? `〔${m.kind}〕` : ''
      lines.push(`${who}${tag}：${m.content}`)
    }
    lines.push('')
  } else {
    lines.push('（还没有往来，刚开始。）\n')
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
  lines.push(...entriesBlock(entries))

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
4. 有没有国籍 / 居留 / 工作权限制——对照这位艺术家的身份（${idOf(profile) || '档案里没填，别猜；拿不准就说需要确认'}）。ta 能不能申？
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

// 工具白名单。
//
// 2026-08-05 实测发现的一件要紧事：Agent SDK **继承了你整台机器的工具配置**——
// 不写 allowedTools 的话，Fairwind 拿得到 Bash、Write、Supabase MCP。
// 所以这个白名单从「一个稳妥的做法」升级成必须写死的护栏，一天都不能省。
const READ_TOOLS = ['WebSearch', 'WebFetch']

// 邮件那档另外给。claude.ai 的 Gmail 连接器**整套工具里根本没有 send**——
// 只有读和 create_draft / update_draft。所以「它发不出去」不是我们关掉的，
// 是这个能力不存在。ToolSearch 要一起给，那几个工具是延迟加载的。
const GMAIL_TOOLS = [
  'ToolSearch',
  'mcp__claude_ai_Gmail__search_threads',
  'mcp__claude_ai_Gmail__get_thread',
  'mcp__claude_ai_Gmail__get_message',
  'mcp__claude_ai_Gmail__create_draft',
]

async function think(prompt, tools = READ_TOOLS, profile = null) {
  const out = []
  let usage = null
  for await (const m of query({
    prompt,
    options: {
      systemPrompt: systemFor(profile),   // 完全自定义人格，不加载 Claude Code 那套编码 prompt
      allowedTools: tools,
      permissionMode: 'bypassPermissions',      // 无人值守；面是白名单锁死的
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
  const { text, meta } = body
  const owner = ownerOf(body)
  if (!owner || !text?.trim()) throw new Error('要有 pursuit_id 或 contact_id，外加 text')

  // 先落库：哪怕后面想崩了，你说的话也不会丢。
  // meta 只贴在**你这条**上——它记的是「你这句是怎么发出来的」（群发/单发），
  // 不是这条线的属性，更不是 Fairwind 回复的属性。
  const mine = await addMessage(owner, 'artist', text.trim(), 'message', meta || null)

  const ctx = await loadOwnerContext(owner)
  console.log(`  ↳ 上下文：${ctx.msgs.length} 条往来 / ${ctx.entries.length} 条信息库`)
  const { text: reply, usage } = await think(buildPrompt(ctx, text.trim(), mine.id), READ_TOOLS, ctx.profile)
  console.log(`  ↳ Fairwind 想完了：${usage.turns} 轮 / ${(usage.ms / 1000).toFixed(1)}s`)

  const theirs = await addMessage(owner, 'producer', reply)
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

  const { text, usage } = await think(buildBriefPrompt(ctx), READ_TOOLS, ctx.profile)
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

// ── 邮件 ───────────────────────────────────────────────────────
//
// 这两个口是 2026-08-05 那一刀开的。分工写在设计稿里，一句话：
//   **后台进货（扫聚合源、扫信箱找陌生来信、造卡），页面加工（一条线里面的事）。**
// 这儿两个都属于「加工」——它们只碰你正打开的那一条线，不遍历你的信箱。

// 把一份产出放进 Gmail 草稿箱。
//
// 注意它**不定稿**。邮件的定稿分两步：放进草稿箱（这儿），和你在 Gmail 里
// 真的按发送。只有第二步发生了、下次同步把它当成一封真信收回来，
// 球权才翻。不然系统会替你撒一个你察觉不到的谎：那条线显示「等回复」，
// 而信还躺在草稿箱里没人收到。
async function handleGmailDraft(body) {
  const { deliverable_id } = body
  const owner = ownerOf(body)
  if (!owner || !deliverable_id) throw new Error('要有 pursuit_id 或 contact_id，外加 deliverable_id')

  const ctx = await loadOwnerContext(owner)
  const d = (ctx.raw.deliverables || []).find((x) => x.id === deliverable_id)
  if (!d) throw new Error(owner.kind === 'contact' ? '这个人名下没有这份产出' : '这条线上没有这份产出')
  if (d.status === 'final') throw new Error('已定稿的不用再放草稿箱')
  if (!d.body?.trim()) throw new Error('正文是空的，没东西可放')

  const threads = (ctx.raw.threads || []).map((t) => t.gmail_thread_id)
  const { text } = await think(
    `把下面这封信放进${mailboxOf(ctx.profile) ? ` ${artistOf(ctx.profile)}（${mailboxOf(ctx.profile)}）的` : ''} Gmail 草稿箱。**只建草稿，不发送**——你也没有发送的工具。

${owner.kind === 'contact' ? '收信人' : '机会线'}：${ctx.p.title}${ctx.p.org ? ` · ${ctx.p.org}` : ''}${owner.kind === 'contact' && ctx.p.email ? ` <${ctx.p.email}>` : ''}
${threads.length ? `已认领的 thread：${threads.join(', ')}——把草稿建成对最新那封的回复。`
  : '还没认领 thread。先用 search_threads 按机构名/对方地址找到最近那串往来，作为回复目标；找不到就新建一封。'}

主题：${d.title}

正文（原样使用，一个字都不要改写——这是他定的稿）：
---
${d.body}
---

建完之后，**最后一行**单独输出这个，别的什么都不要加：
[[DRAFT]] {"draft_id":"…","thread_id":"…","to":"…"}`,
    GMAIL_TOOLS,
    ctx.profile,
  )

  const m = text.match(/\[\[DRAFT\]\]\s*(\{[\s\S]*?\})\s*$/)
  let info = null
  try { info = m ? JSON.parse(m[1]) : null } catch (_) { info = null }
  if (!info?.draft_id) throw new Error('草稿没建成（Fairwind 没报回 draft_id）')

  // 认领这个 thread：下次同步就会跟着它走
  if (info.thread_id) {
    if (owner.kind === 'contact') {
      await db.rpc('pa_claim_contact_thread', { p_contact_id: owner.id, p_thread_id: info.thread_id })
    } else {
      await db.rpc('pa_link_thread', {
        p_pursuit_id: owner.id, p_thread_id: info.thread_id, p_added_by: 'fairwind',
      })
    }
  }
  const meta = { ...(d.meta || {}), gmail_draft_id: info.draft_id, to: info.to || null }
  const { error } = await db.rpc(
    owner.kind === 'contact' ? 'pa_upsert_contact_deliverable' : 'pa_upsert_deliverable',
    {
      ...(owner.kind === 'contact' ? { p_contact_id: owner.id } : { p_pursuit_id: owner.id }),
      p_id: deliverable_id, p_kind: d.kind, p_title: d.title, p_meta: meta,
    })
  if (error) throw new Error('记草稿号失败：' + error.message)
  return { ok: true, ...info }
}

// 按线收信：只拉这条线登记过的 thread，永远不遍历信箱。
//
// 顺序要紧：**先落原文，后写摘要**。第一步是机械的，不会因为脑子没开就丢信；
// 摘要失败了行还在，界面显示原文首段。反过来做的话，模型一挂那封信就永远不存在。
// 认领：这条线该去 Gmail 里跟哪几串。
//
// 库里已有的信自己就带着答案——每条 pursuit_messages 都存了 gmail_message_id，
// 而 Gmail 的 get_message 能从 message id 反查出它属于哪个 thread。
// 所以「这条线有 5 封信，却说没处可收」这种矛盾根本不该出现：
// 有信就有串，让它自己接上，不用你去贴链接。
//
// 一条线只会走一次（认领完就落进 producer.pursuit_threads 了）。
async function ensureThreads(owner, ctx) {
  const o = asOwner(owner)
  const have = (ctx.raw.threads || []).map((t) => t.gmail_thread_id)
  if (have.length) return have

  const known = ctx.msgs.filter((m) => m.gmail_message_id).map((m) => m.gmail_message_id)
  if (!known.length) return []

  const { text } = await think(
    `查这些 Gmail message 各属于哪个 thread（用 mcp__claude_ai_Gmail__get_message，读 threadId 就行，别读正文）：
${known.join(', ')}

去重后，**最后一行**单独输出，别的什么都不要加：
[[THREADS]] {"thread_ids":["…"]}`,
    GMAIL_TOOLS,
    ctx.profile,
  )
  const m = text.match(/\[\[THREADS\]\]\s*(\{[\s\S]*?\})\s*$/)
  let ids = []
  try { ids = m ? (JSON.parse(m[1]).thread_ids || []) : [] } catch (_) { ids = [] }
  for (const t of ids) {
    if (o.kind === 'contact') {
      await db.rpc('pa_claim_contact_thread', { p_contact_id: o.id, p_thread_id: t })
    } else {
      await db.rpc('pa_link_thread', { p_pursuit_id: o.id, p_thread_id: t, p_added_by: 'fairwind' })
    }
  }
  return ids
}

async function handleSync(body) {
  const owner = ownerOf(body)
  if (!owner) throw new Error('要有 pursuit_id 或 contact_id')

  const ctx = await loadOwnerContext(owner)
  const threads = await ensureThreads(owner, ctx)
  if (!threads.length) {
    // 真的无处可收：一封信都没有，所以连反查的线头都没有。
    // 说清楚是「还没有往来」，别让它看起来像「查过了，没有新信」——那两件事天差地别。
    return { ok: true, threads: 0, added: 0,
      note: owner.kind === 'contact'
        ? '这个人还没认领任何邮件往来，所以没处可收。在名片上认领一条，或者起草一封发出去。'
        : '这条线还没有任何邮件往来，所以没处可收。起草一封发出去，它就接上了。' }
  }

  const known = ctx.msgs.filter((m) => m.gmail_message_id).map((m) => m.gmail_message_id)
  const { text } = await think(
    `读这几个 Gmail thread，把**还没入库**的邮件抓出来。

thread：${threads.join(', ')}
库里已有的 message id（这些跳过）：${known.join(', ') || '（一封都没有）'}

对每一封新的，给我：
· id           Gmail message id
· role         "org"（对方发的）或 "artist"（${artistOf(ctx.profile)} 发的）
· at           ISO 时间，真实发信时间
· subject/from
· raw          正文纯文本（**原样**，不要摘、不要改）
· summary      一句中文摘要，说清这封信要什么或给了什么

**最后一行**单独输出，别的什么都不要加：
[[MAIL]] {"messages":[{"id":"…","role":"org","at":"…","subject":"…","from":"…","raw":"…","summary":"…"}]}
一封新的都没有就输出 [[MAIL]] {"messages":[]}`,
    GMAIL_TOOLS,
    ctx.profile,
  )

  const m = text.match(/\[\[MAIL\]\]\s*(\{[\s\S]*\})\s*$/)
  let parsed = null
  try { parsed = m ? JSON.parse(m[1]) : null } catch (_) { parsed = null }
  if (!parsed) throw new Error('收信回来的格式不对，没敢往库里写')

  let added = 0
  let addedIn = 0
  for (const mail of parsed.messages || []) {
    if (!mail?.id || !mail?.role) continue
    const { data, error } = await db.rpc(
      owner.kind === 'contact' ? 'pa_add_contact_email' : 'pa_add_email',
      {
        ...(owner.kind === 'contact' ? { p_contact_id: owner.id } : { p_pursuit_id: owner.id }),
        p_role: mail.role === 'artist' ? 'artist' : 'org',
        p_gmail_message_id: mail.id,
        p_content: mail.summary || (mail.raw || '').slice(0, 200),
        p_body_raw: mail.raw || null,
        p_meta: { subject: mail.subject || null, from_name: mail.from || null },
        p_created_at: mail.at || null,
      })
    if (error) { console.warn('  ⚠️ 一封没写进去：' + error.message); continue }
    if (data?.inserted) { added++; if (mail.role !== 'artist') addedIn++ }
  }
  for (const t of threads) {
    if (owner.kind === 'contact') {
      await db.rpc('pa_touch_contact_thread', { p_contact_id: owner.id, p_thread_id: t, p_history_id: null })
    } else {
      await db.rpc('pa_touch_thread', { p_pursuit_id: owner.id, p_thread_id: t, p_history_id: null })
    }
  }
  // addedIn = 对方来的那几封。你自己发的信收录进档案不该惊动你——你知道你发过。
  // 前端拿它当过卡判据 1，added 仍是总数（进度和日志用）。
  return { ok: true, threads: threads.length, added, addedIn }
}

// ── 更新最新信息：收信 → （收到了才）消化 ─────────────────────
//
// 只消化事实，不主动巡逻：added=0 就一个字不写。
// 在没变化的线上编一句凑数的话，哪怕只发生一次，这个按钮就不可信了。
//
// 消化 = 两问：① 新信让现在的待办作废了吗 ② 现在该干什么。
// 答案落库走 0029 的两个口子——闸在库里（你的活待办拒绝覆盖、
// 作废必须指认哪封信），prompt 只是第一道，不是唯一一道。
// 人身上的「更新最新信息」——比机会线那套简单得多。
//
// 线上那一套（待办作废 / 下一步提案）在人身上没有对应物：人没有 next_action，
// 也没有阶段和截止。人身上唯一要消化的是**时间锚点**。
//
// 「circle back next semester」在美国语境里**是真话**，是真的邀请你在那个时间点
// 再来一次。婉拒长的是另一个样子（not a fit at this time），而且不给时间锚点。
// 0011 那份迁移开头记着两条真事：LACHSA 和 Ruth Asawa SOTA 都给了锚点，
// 都因为没人记得再碰而飘掉了。
//
// 认不出来就**什么都不写**——不猜、不用默认值。名片上永远留一个手填的口。
// 这是整刀里唯一「调出来的」东西，所以它必须能干净降级：
// 它认不准，最坏也只是这个由头不出现，不会往库里写一个假日期。
async function handlePersonRefresh(contactId) {
  const sync = await handleSync({ contact_id: contactId })
  if (!sync.added) return { ...sync, anchored: false }

  const ctx = await loadPersonContext(contactId)
  const fresh = ctx.msgs.filter((m) => m.gmail_message_id).slice(-sync.added)
  const inbound = fresh.filter((m) => m.role === 'org')
  if (!inbound.length) return { ...sync, anchored: false }   // 全是你自己发的，没什么可消化

  const { text } = await think(
    `${ctx.p.title} 刚回了 ${inbound.length} 封信。只问一件事：**他有没有给出再联系的时间锚点？**

【新信】
${inbound.map((m) => `${m.created_at?.slice(0, 10) || '?'}：${m.body_raw || m.content}`).join('\n---\n')}
【今天】${new Date().toISOString().slice(0, 10)}

算数的锚点长这样：circle back next semester / after March / in the fall / 具体日期 /
「等我们排完下学期课表」。这些**是真话**，不是客套。

不算数的：「not a fit at this time」「we don't have capacity」这类婉拒，
以及任何**没给时间**的客气话。它们一律当成没有锚点。

有锚点就**最后一行**单独输出，别的什么都不要加：
[[NEXT]] {"at":"2026-09-01","quote":"circle back next semester"}
at 是你把那句话折算成的日期，quote 是**原话**，一个字都别改。

没有锚点就**这一行整个不要输出**——宁可不说，不许猜。`,
    READ_TOOLS,
    ctx.profile,
  )

  const m = text.match(/\[\[NEXT\]\]\s*(\{[\s\S]*?\})\s*$/m)
  let a = null
  try { a = m ? JSON.parse(m[1]) : null } catch (_) { a = null }
  if (!a?.at || !a?.quote) return { ...sync, anchored: false }

  const { error } = await db.rpc('pa_upsert_contact', {
    p_id: contactId, p_next_touch_at: a.at, p_next_touch_why: `他说 "${a.quote}"`,
  })
  if (error) return { ...sync, anchored: false, note: '锚点没写进去：' + error.message }
  return { ...sync, anchored: true, next_touch_at: a.at, quote: a.quote }
}

async function handleRefresh(body) {
  const owner = ownerOf(body)
  if (!owner) throw new Error('要有 pursuit_id 或 contact_id')
  if (owner.kind === 'contact') return handlePersonRefresh(owner.id)
  const pursuit_id = owner.id

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
${fresh.map((m) => `${m.created_at?.slice(0, 10) || '?'} ${m.role === 'artist' ? artistOf(ctx.profile) : (m.meta?.from_name || '对方')}：${m.content}`).join('\n')}
【截止】${p.deadline_at || p.deadline || '无'}　【该碰日】${p.next_touch_at || '无'}

问题一：新信有没有让卡上那条待办**过期**？（比如「没回就催」而对方回了。）
过期了就指认是哪封信，说一句人话的理由。没过期、或根本没待办，就 null。

问题二：读完新信，这条线**现在**该干什么？必须能指着某封信或某个日期说出依据。
说不出依据就 null——宁可不说，也不猜。凑数的话比空着更坏。
如果该干的事有明确日子（比如信里约了 8/12 回复），给 touch 一个 YYYY-MM-DD。

**最后一行**单独输出，别的什么都不要加：
[[DIGEST]] {"void": {"msg_id": "<作废依据那封信的库内 id，从上面往来里没有就用最新那封的 gmail id 对应行>", "reason": "…"} | null, "next": {"action": "一句话，20 字内", "basis": "依据（哪封信/哪个日期）", "touch": "YYYY-MM-DD 或 null"} | null}`,
    READ_TOOLS,
    ctx.profile,
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
// 「新机会」这个列名承诺的是「 Fairwind 已经读透了，就等你点头」。所以读这件事
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
    if (error) { console.warn('⚠️ 扫新机会失败：' + error.message); return }

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
        console.log(`\n→ ${new Date().toLocaleTimeString('zh-CN')} ${isDraft ? '放草稿箱' : isRefresh ? '更新' : '收信'} ${body.contact_id ? `人 ${body.contact_id}` : body.pursuit_id}`)
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
  console.log(`   后台先读：每 ${Math.round(SWEEP_MS / 1000)} 秒扫一次「新机会」`)
  console.log(`   计费：走你的 Claude 订阅用量（没用 API key）\n`)
  sweepBriefs()
  setInterval(sweepBriefs, SWEEP_MS)
})
