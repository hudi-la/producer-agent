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
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { read, slice, imageBudget, IMG_CAP } from './files.js'
// 拼 prompt 的活儿全在 prompt.js —— 纯函数，所以有 prompt.test.js 按着。
// 那边把一次对话切成三档：静态 systemPrompt（人格 + 档案 + 信息库，跨会话缓存）、
// 动态 systemPrompt（这条线自己的资料）、user message（往来 + 你刚说的那句）。
import {
  artistOf, idOf, mailboxOf, systemFor,
  buildSystem, buildUser, buildBriefSystem, buildBriefUser,
} from './prompt.js'
// 从一次「想」里挑出给人看的那一段：动工具之前说的都是工作稿。
import { foldReply } from './reply.js'
// 它写完一封信会在末尾报一声。摘出来存进 meta，正文里不留那行机器读的字。
import { extractLetter } from './letter.js'
// 填完一张表也报一声。逐格的字数闸靠它带过来——那是申请表的要害。
import { extractForm } from './form.js'

import { parseTriage, triagePrompt } from './triage.js'
import { parseRejudge, rejudgePrompt } from './rejudge.js'
import { eventOf, parseTag, cellFor, parseMet } from './judge.js'
import { directive as timerDirective, timerKey } from './timer.js'
// 人的「收信」走机械管线：账本 → 拉正文 → 入库。找信不花模型。
import { promote } from './mail/adopt.js'
// 发信：纯 HTTP，一次模型都不过。**这几个不进工具白名单**——
// 模型够不到它们，跟它够不到别条线的文件是同一种「够不到」。
import { client as mailClient, whoami } from './mail/auth.js'
import { gmailFor } from './mail/gmail.js'
import { sendLetter, assertSameMailbox } from './mail/send.js'
import { recordSent } from './send-record.js'

// 默认值必须和前端 backends.js 里的 BRAIN 对得上。两边默认值不一致的话，
// brain/.env 一丢，脑子听一个端口、界面敲另一个，结果是永远误报「脑子没开」。
// 改了这个文件里任何「界面依赖的行为」，就把这个日期往前挪一格，同时改
// src/lib/backends.js 里的 BRAIN_BUILD。两边对不上界面会提示你重启脑子。
//
// 为什么需要它：脑子是你手动 `npm run brain` 起的一个常驻进程。改了代码不重启，
// 它就一直跑着旧的——而界面完全看不出来。这已经害过一次：把「讲懂」改成后台扫
// 之后，前端的触发器删了、后台的扫描没跑起来，于是整整一天没有一张新卡被读过，
// 谁也没发现。和「迁移写了没跑」是同一个病。
export const BRAIN_BUILD = '2026-08-18a'

const PORT = Number(process.env.BRAIN_PORT || 8788)
// 邮件多久收一次。别调太快：收信本身很便宜，但每轮可能带一次判地址。
const MAIL_MS = Number(process.env.MAIL_SWEEP_MS || 5 * 60 * 1000)
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

// 正在想的那些活：run_id → AbortController。你按「终止」时靠它找到对应那一次。
//
// 为什么要有这张表：光在浏览器里断掉请求是假停——连接断了，这边 think() 照跑，
// 几十秒后回复照样落库、被轮询捞出来。要真停，得停在这儿。
// run_id 由浏览器生成并随 /chat 一起发过来，不是这边生成再回传的——
// 回传得等 think() 想完，那时候早没得停了。
const RUNS = new Map()

// ── 这条线上的文件 ────────────────────────────────────────────
//
// 为什么是工具，不是上下文：把每条线的每份文件都塞进 prompt，既贵又吵，
// 而且大部分对话根本用不上。要用的时候现开一份，这才是人翻文件的方式。
//
// 护栏在闭包里，不在提示词里：这台工具是**按这一次对话现造的**，
// atts 是这条线的附件清单，写死在函数里。别条线的文件、磁盘上别的东西，
// 不是「不许它碰」，是它够不到——跟 0009 / 0027 那套一样，结构上做不到。
//
// 格式一视同仁：从它那边看只有「给名字，拿回能读的东西」。PDF 要解析、
// Excel 要遍历工作表、图片原样交给模型自己看——这些差别只活在 files.js 里。
const FILE_TOOL = 'mcp__pursuit_files__open_file'

function filesServer(atts) {
  const find = (name) => {
    const n = (name || '').trim().toLowerCase()
    return atts.find((a) => a.filename.toLowerCase() === n)
      || atts.find((a) => a.filename.toLowerCase().includes(n))   // 说个大概也认
  }
  // 图片的额度，跟着这一次对话活。造在这儿而不是模块顶上——
  // 放模块顶上的话它会跨对话累加，聊到第四条线就再也开不了图了。
  const budget = imageBudget()
  return createSdkMcpServer({
    name: 'pursuit_files',
    tools: [
      tool(
        'open_file',
        `打开这条机会线上的一份文件。文本类拿回文字，图片类你直接看得见。文件清单在 prompt 里给了；要用哪份才开哪份，别一上来全开一遍。文件太长会分段给你，按提示用 from 接着要下一段。

图片格外要克制：一段文字开完就沉进历史，一张图**进来就一直占着上下文，后面每一轮都重付一次**。所以图只在真要看它才开——判断得靠图里的东西（作品长什么样、海报上的日期、截图里的报错）才开；光是"这条线上有张图"不是理由。一条对话最多 ${IMG_CAP} 张。`,
        {
          name: z.string().describe('文件名，跟清单里写的一致（写个能认出来的片段也行）'),
          from: z.number().optional().describe('从第几个字接着看。第一次不用传。图片没有分段，不用传'),
        },
        async ({ name, from }) => {
          const a = find(name)
          if (!a) {
            const list = atts.map((x) => x.filename).join('、') || '（这条线上没有文件）'
            return { content: [{ type: 'text', text: `没有叫「${name}」的文件。这条线上有：${list}` }] }
          }
          if (!a.storage_key) {
            return { content: [{ type: 'text', text: `《${a.filename}》只有登记、没有字节，打不开。` }] }
          }
          try {
            const dl = await db.storage.from('pursuit-files').download(a.storage_key)
            if (dl.error) throw new Error(dl.error.message)
            const buf = Buffer.from(await dl.data.arrayBuffer())
            const got = await read(buf, a.filename, a.mime)

            if (got.kind === 'image') {
              // 闸门在这儿，不在提示词里。上面那段描述是劝它省着开，
              // 这一句是它没听进去时真的拦下来。
              const pass = budget.admit(a.filename)
              if (!pass.ok) {
                console.log(`  ↳ 它想再开一次《${a.filename}》，挡了：${pass.why}`)
                return { content: [{ type: 'text', text: pass.why }] }
              }
              console.log(`  ↳ 它开了《${a.filename}》（图，进上下文了）`)
              // 先给一行字说明这是哪张图——不然它看到一张没头没尾的图，
              // 不知道这是这条线上的哪一份。
              return {
                content: [
                  { type: 'text', text: `# ${a.filename}` },
                  { type: 'image', data: got.data, mimeType: got.mimeType },
                ],
              }
            }

            budget.text()
            const { body, note } = slice(got.text, from || 0)
            console.log(`  ↳ 它开了《${a.filename}》${from ? `（从 ${from} 字接着）` : ''}`)
            return { content: [{ type: 'text', text: `# ${a.filename}\n\n${body}${note}` }] }
          } catch (err) {
            // 读不了要明说读不了。返回半通不通的东西更糟——那会被当成内容引用进一封真信里。
            return { content: [{ type: 'text', text: `《${a.filename}》打不开：${err.message}` }] }
          }
        },
      ),
    ],
  })
}

/**
 * 让它想。
 *
 * onEvent 传了，就一边想一边把字报出去（SDK 的 includePartialMessages）。
 * 不传的行为跟以前一模一样 —— 「讲懂」「认人」这些后台活没人盯着屏幕，
 * 不该为一份没人看的预览多解析一遍事件。
 *
 * **报出去的字和存进库的字是两份。** 库里那份仍旧从 assistant 消息的 text 块攒
 * （下面的 out），delta 只是给眼睛看的预览。delta 可能丢、可能顺序怪，
 * 落库的内容不能将就这个。
 */
/**
 * system 收三种东西，都认：
 *   · 块数组 ['静态', BOUNDARY, '动态']  —— 新路子。静态块拿的是跨会话的缓存作用域。
 *   · 一段字符串                        —— 直接当 systemPrompt 使。
 *   · profile 对象 / null               —— 老路子，等于「只要人格」。
 *
 * 第三种是给后台那五处活儿（收信 / 认人 / 查 thread / 消化 / 建草稿）留的：
 * 它们的 prompt 里本来就没有战绩信息库，不能因为改缓存反倒给它们每次塞进两万字符。
 * 一个字都不用改，是这条兜底的全部意义。
 */
const asSystem = (s) => (typeof s === 'string' || Array.isArray(s) ? s : systemFor(s))

async function think(prompt, tools = READ_TOOLS, system = null, abortController = null, mcpServers = null, onEvent = null, maxTurns = 20) {
  // 按发生顺序收下 text / tool_use 两种块，最后交给 foldReply 挑出「给人看的那段」。
  // 原来这儿是 out.push(b.text) 无差别攒 —— 于是 20 轮的英文工作稿全被拼进落库的回复。
  const blocks = []
  let usage = null
  // 界面那头断了不该带崩这一轮 —— 它还得把回复写进库里。
  const tell = onEvent ? (e) => { try { onEvent(e) } catch (_) {} } : null
  let said = false   // 已经报过字没有：决定要不要在下一块前面补个换行
  const toldTools = new Set()   // 已经报过的 tool_use id，挡住流和消息两条路的重复

  // 「首字多久到」是这条路唯一要紧的健康指标。总耗时看不出问题：
  // 边想边出字的意义全在第一个字来得早，而它可能被思考、被工具、被
  // 一大坨上下文的 TTFT 推后——不记时间就只能猜是哪一个。
  const t0 = Date.now()
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + 's'
  let firstAt = null, thoughtAt = null
  for await (const m of query({
    prompt,
    options: {
      // 完全自定义人格，不加载 Claude Code 那套编码 prompt。
      // 传数组时每一块拿自己的缓存作用域——分界标记之前的是全局的（跨会话、
      // 跨这个进程重启都可能命中），之后的只活在这一次。
      systemPrompt: asSystem(system),
      allowedTools: tools,
      permissionMode: 'bypassPermissions',      // 无人值守；面是白名单锁死的
      maxTurns,
      ...(tell ? { includePartialMessages: true } : {}),
      ...(abortController ? { abortController } : {}),
      ...(mcpServers ? { mcpServers } : {}),
    },
  })) {
    // 边想边报。out 是按 text 块攒、最后 join('\n') 的，所以第二块起要先补个
    // 换行，不然预览比最终文本少几个换行，最后换那一下页面会跳。
    if (tell && m.type === 'stream_event') {
      const ev = m.event
      if (ev?.type === 'content_block_start' && ev.content_block?.type === 'text' && said) {
        tell({ t: 'delta', text: '\n' })
      }
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        if (firstAt === null) { firstAt = Date.now() - t0; console.log(`  ↳ 首字 ${secs()}`) }
        said = true
        tell({ t: 'delta', text: ev.delta.text })
      }
      // 工具块一开始就报，不等这一轮生成完。
      //
      // 为什么要抢这半秒：界面收到 tool 就把刚画出来的字抹掉（那是工作稿）。
      // 等 assistant 消息到了才报的话，开场白那行英文早已经在屏幕上待了一会儿，
      // 抹掉也来不及了——人已经看见了。
      if (ev?.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        const id = ev.content_block.id
        if (!toldTools.has(id)) {
          toldTools.add(id)
          console.log(`  ↳ 动工具 ${secs()}：${ev.content_block.name}`)
          tell({ t: 'tool', name: ev.content_block.name })
        }
      }
      // 它在想（自适应思考）。思考不产可见的字，是「首字为什么这么晚」
      // 最可能的答案之一——记一笔，好把它跟工具、跟 TTFT 分开。
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta' && thoughtAt === null) {
        thoughtAt = Date.now() - t0
        console.log(`  ↳ 开始想 ${secs()}`)
        tell({ t: 'thinking' })
      }
    }
    if (m.type === 'assistant') {
      for (const b of m.message.content) {
        if (b.type === 'text' || b.type === 'tool_use') blocks.push(b)
        // 兜底：上面那条走的是 partial 流，万一某个版本的 SDK 不发 tool_use 的
        // content_block_start，这儿还能补报一次。toldTools 挡住重复。
        // 联网查资料那一轮一个字都不产。不报工具的话，界面在最长的那段等待里
        // 跟改之前一模一样 —— 三个死点，看不出它到底在干嘛。
        if (tell && b.type === 'tool_use' && !toldTools.has(b.id)) {
          toldTools.add(b.id)
          console.log(`  ↳ 动工具 ${secs()}：${b.name}`)
          tell({ t: 'tool', name: b.name })
        }
      }
    }
    if (m.type === 'result') {
      // 记账。原来这儿只留了耗时和轮数，把 SDK 给的 token 数直接扔了——
      // 于是「这个月怎么涨这么快」只能靠猜，改完也不知道有没有改对。
      // cacheRead 是这次改动的验收指标：静态块要是真跨会话命中了，
      // 它应该稳定在信息库那个量级上；一直接近 0 就是断点没落到该落的地方。
      const u = m.usage || {}
      usage = {
        ms: m.duration_ms, turns: m.num_turns, subtype: m.subtype, firstMs: firstAt,
        inp: u.input_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
        cacheWrite: u.cache_creation_input_tokens || 0,
        out: u.output_tokens || 0,
        usd: m.total_cost_usd || 0,
      }
      if (m.subtype !== 'success') throw new Error('Fairwind 没想完：' + m.subtype)
    }
  }
  // 每一次动模型都报一次账，不只是聊天那条路——「讲懂」「收信」「消化」
  // 也在花钱，而它们全在后台跑，没人盯着屏幕。不报的话，涨得快是查不出来源的。
  const n = (x) => x.toLocaleString('en-US')
  console.log(`  ↳ token：新读 ${n(usage.inp)} / 缓存读 ${n(usage.cacheRead)} / 缓存写 ${n(usage.cacheWrite)} / 出 ${n(usage.out)}` +
              (usage.usd ? ` / $${usage.usd.toFixed(4)}` : ''))

  // 动工具之前说的话都是工作稿，不是回答（判据见 reply.js）。工作稿不扔，
  // 跟着 notes 回去存进消息的 meta —— 里面是真查到的东西，只是不该摆在她眼前，
  // 也不该每轮都重新塞进 prompt。
  const { text, notes, recovered } = foldReply(blocks)
  if (notes.length) {
    const 字 = notes.reduce((n, s) => n + s.length, 0)
    console.log(`  ↳ 工作稿 ${notes.length} 段 / ${n(字)} 字符 —— 收进 meta，不进回复也不进下一轮 prompt`)
  }
  // 顶上来的必须说出来。悄悄把工作稿当回答端出去，就是这次要治的那个病本身。
  if (recovered) console.log('  ⚠️ 最后一轮它一个字没说，拿最后一段工作稿顶上了')
  if (!text) throw new Error('Fairwind 没说话（空回复）')
  return { text, usage, notes, recovered }
}

// ── HTTP ────────────────────────────────────────────────────

async function handleChat(body, onEvent = null) {
  const { text, meta, run_id } = body
  const owner = ownerOf(body)
  if (!owner || !text?.trim()) throw new Error('要有 pursuit_id 或 contact_id，外加 text')

  // 先落库：哪怕后面想崩了，你说的话也不会丢。
  // meta 只贴在**你这条**上——它记的是「你这句是怎么发出来的」（群发/单发），
  // 不是这条线的属性，更不是 Fairwind 回复的属性。
  const mine = await addMessage(owner, 'artist', text.trim(), 'message', meta || null)
  // 早点报出去：界面拿它把乐观插入的那条临时消息换成真的（带 id、带时间）。
  onEvent?.({ t: 'mine', row: mine })

  // 见面复盘：正等着你说「见得怎么样」的时候，你说的这句就是答案。
  // 判「见成了吗」——成了就把你的原话记成一条 kind='meet' 的笔（那才是
  // 事实），48 小时信、回谢介绍人都从那条笔自己长出来（0097 的两支）。
  // 改约了就把新时间写回原来那个约的标签上。判不出来就什么都不动。
  try {
    const o = asOwner(owner)
    const { data: st } = await db.from('v_pa_state').select('*')
      .eq('subject_kind', o.kind).eq('subject_id', o.id).maybeSingle()
    if (st?.state === 'DEBRIEF') {
      const cell = cellFor('DEBRIEF', 'YOUR_ANSWER')
      const { text: verdict } = await think(cell.ask(text.trim(), st), [], JUDGE_SYSTEM, null, null, null, 1)
      const met = parseMet(verdict)
      if (met?.met === true) {
        await db.rpc(o.kind === 'contact' ? 'pa_add_contact_message' : 'pa_add_pursuit_note',
          o.kind === 'contact'
            ? { p_contact_id: o.id, p_role: 'note', p_kind: 'meet', p_content: text.trim() }
            : { p_pursuit_id: o.id, p_text: text.trim(), p_kind: 'meet' })
        console.log(`  · 见成了 —— 记成一条 meet 笔（${met.gist || ''}）`)
      } else if (met?.met === false && met.meet_at && st.anchor_id) {
        await db.rpc('pa_tag_message', {
          p_message_id: st.anchor_id, p_situation: 'DEBRIEF x YOUR_ANSWER',
          p_meet_at: met.meet_at, p_gist: met.gist || '改约了',
        })
        console.log(`  · 没见成，改约到 ${met.meet_at}`)
      }
    }
  } catch (err) { console.warn('  ⚠️ 复盘那一步没走成（不挡聊天）：' + err.message) }

  const ctx = await loadOwnerContext(owner)
  // 这条线上的文件。人没有就是空数组——人那一层（contact）不带附件。
  const atts = ctx.raw?.attachments || []
  console.log(`  ↳ 上下文：${ctx.msgs.length} 条往来 / ${ctx.entries.length} 条信息库${atts.length ? ` / ${atts.length} 份文件` : ''}`)

  // 有文件才给这台工具。没文件还挂着，等于告诉它「你可以去开文件」，
  // 然后它去开一个不存在的东西——白跑一轮，还得自己想明白为什么开不到。
  const tools = atts.length ? [...READ_TOOLS, FILE_TOOL] : READ_TOOLS
  const servers = atts.length ? { pursuit_files: filesServer(atts) } : null

  const ac = run_id ? new AbortController() : null
  if (ac) RUNS.set(run_id, ac)
  let reply, usage, notes, recovered
  try {
    ;({ text: reply, usage, notes, recovered } = await think(
      // user message 只剩往来 + 你刚说的那句；档案、信息库、卡上字段都进了 systemPrompt。
      buildUser(ctx, text.trim(), mine.id), tools, buildSystem(ctx), ac, servers, onEvent,
    ))
  } catch (err) {
    // 你按了终止：不写回复，也不算出错。你那条留着（是你说的话，不是它想的）。
    if (ac?.signal.aborted) {
      console.log('  ↳ 你终止了这一次，没写回复')
      return { mine, reply: null, aborted: true }
    }
    throw err
  } finally {
    if (run_id) RUNS.delete(run_id)
  }
  // 首字比总耗时要紧：边想边出字的意义全在第一个字来得早。
  const firstSay = usage.firstMs != null ? ` / 首字 ${(usage.firstMs / 1000).toFixed(1)}s` : ''
  console.log(`  ↳ Fairwind 想完了：${usage.turns} 轮 / ${(usage.ms / 1000).toFixed(1)}s${firstSay}`)

  // 信封摘出来存进 meta，**正文里不留那行机器读的字**——留着的话，你从
  // 气泡里复制走的时候会把它一起粘进 Gmail。界面据 meta.letter 画那张信卡。
  //
  // 两种标记都摘：一次回复里不会既是信又是表，但摘的顺序不能让另一个漏网——
  // 所以是串起来摘，前一个的 clean 交给后一个。
  const one = extractLetter(reply)
  const two = extractForm(one.clean)
  const shown = two.clean
  const letter = one.letter
  const form = two.form

  // 工作稿存进 meta：不摆在她眼前、不进下一轮 prompt，但一个字都没销毁，
  // 查得回来。recovered 也记一笔——那条回复是拿工作稿顶上的，将来看日志得认得出。
  const extra = {
    ...(notes?.length ? { notes } : {}),
    ...(recovered ? { recovered: true } : {}),
    ...(letter ? { letter } : {}),
    ...(form ? { form } : {}),
  }
  const theirs = await addMessage(owner, 'producer', shown, 'message',
    Object.keys(extra).length ? extra : null)
  return { mine, reply: theirs }
}

// 终止：把那一次正在想的活掐掉。找不到就说找不到——可能已经想完了，
// 也可能是脑子重启过。两种情况都不是错，前端照样把界面解开。
function handleStop(body) {
  const { run_id } = body
  if (!run_id) throw new Error('要有 run_id')
  const ac = RUNS.get(run_id)
  if (!ac) return { ok: true, stopped: false }
  ac.abort()
  RUNS.delete(run_id)
  return { ok: true, stopped: true }
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

  const { text, usage, notes } = await think(buildBriefUser(ctx), READ_TOOLS, buildBriefSystem(ctx))
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

  // 「讲懂」是联网活儿，工作稿只多不少（八条中招的里面六条是 brief）。同样收进 meta。
  const brief = await addMessage(pursuit_id, 'producer', clean, 'brief',
    notes?.length ? { notes } : null)
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

// 真发一封信。
//
// ══ 这个口跟上面那个 handleGmailDraft 的分别 ══════════════════
// 那个是让**模型**去调连接器建草稿——一次模型往返，非确定性，而且只到
// 草稿箱为止。这个是 brain 自己拿钥匙走 HTTP，一次模型都不过。
//
// **它不在模型的工具白名单里**（READ_TOOLS / GMAIL_TOOLS 都没有它），
// 只有页面上那颗按钮能走到这儿。「Fairwind 写得出信，但按不了发送键」
// 就是这一条。
//
// 顺序也要紧：校验 → 发 → 记账 → 删产出。记账和删产出的先后见
// send-record.js 顶上那段（反了会两头空）。
async function handleSendMail(body) {
  const { deliverable_id } = body
  const owner = ownerOf(body)
  if (!owner || !deliverable_id) throw new Error('要有 pursuit_id 或 contact_id，外加 deliverable_id')

  const ctx = await loadOwnerContext(owner)
  const d = (ctx.raw.deliverables || []).find((x) => x.id === deliverable_id)
  if (!d) throw new Error(owner.kind === 'contact' ? '这个人名下没有这份产出' : '这条线上没有这份产出')
  if (d.kind !== 'email') throw new Error('这份产出不是一封信，发不了')
  if (d.status === 'final') throw new Error('已定稿的不走这条路')
  if (!d.body?.trim()) throw new Error('正文是空的，没东西可发')

  // 收件人是一份名单（0071）。老产出里存的是单个字符串，两种都认——
  // 不认的话，改之前收进产出的那几封信一封都发不出去。
  const listOf = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
    .map((x) => String(x ?? '').trim().toLowerCase())
    .filter((x) => x.includes('@'))
  const to = listOf(d.meta?.to)
  const cc = listOf(d.meta?.cc)
  if (!to.length) throw new Error('这份产出上没有收件人——在页面上勾一个再发')

  // 用错身份发出去的信连道歉都没处发，所以这一条拦在真发之前。
  const me = await whoami()
  assertSameMailbox(me.address, mailboxOf(ctx.profile))

  const replyTo = d.meta?.reply_to || null
  const sent = await sendLetter({
    gmail: gmailFor(await mailClient()),
    from: me.address,
    fromName: artistOf(ctx.profile),
    to,
    cc,
    subject: d.title,
    body: d.body,
    replyTo,
    refs: replyTo ? [replyTo] : null,
    threadId: d.meta?.thread_id || null,
  })

  // 信头那一行要挂在哪个账号名下。按地址找，不拿第一行顶——将来多信箱了，
  // 拿第一行会把这封信记到别的账号名下，而那种错在界面上看不出来。
  // 查不到不致命：pa_mail_headers_upsert 只在 counterpart / direction / sent_at
  // 缺了才滤掉行。
  const { data: accts } = await db.from('v_pa_mail_accounts').select('id,address')
  const acct = (accts || []).find((a) => String(a.address || '').toLowerCase() === me.address)

  await recordSent(db, {
    ownerKind: owner.kind === 'contact' ? 'contact' : 'pursuit',
    ownerId: owner.id,
    deliverableId: deliverable_id,
    sent,
    to,
    cc,
    from: me.address,
    subject: d.title,
    summary: d.meta?.summary || null,
    body: d.body,
    accountId: acct?.id || null,
    replyTo,
    refs: replyTo ? [replyTo] : null,
  })

  return { ok: true, id: sent.id, thread_id: sent.threadId }
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

  // ── 人：他有哪几条往来，**查账本，不问模型** ──
  //
  // 0027 立过「只拉登记过的 thread，永远不遍历信箱」。那条对**机会线**是对的：
  // 一条线就那么几串往来，登记完就够了。
  //
  // 对**人**是错的，而且错得很难发现。Stacy 就栽在这儿：库里认领了 4 条 thread，
  // 她三个地址下实际有 20 条。漏掉的里面有一条是**正在进行的对话**——
  // 她 8/10 刚回过信，而名片上写着「上次碰 7/2」。信没丢，是从来没进来过，
  // 于是那个日期在撒谎，比空着更坏。
  //
  // 但补的办法**不是让模型去 Gmail 搜**（我第一版就是这么写的，错了）。
  // mail_headers 是纯 HTTP 抓来的全量信头账本，答案早就在库里：
  // 他有哪些地址 → contact_emails，那些地址出现在哪些 thread → mail_headers。
  // 一次 join 就完了。**找信是机械活，一次模型都不该花。**
  if (o.kind === 'contact') {
    const { data: ids, error } = await db.rpc('pa_contact_thread_ids', { p_contact_id: o.id })
    if (error) { console.warn('  ⚠️ 查账本失败：' + error.message); return have }
    const fresh = (ids || []).filter((t) => t && !have.includes(t))
    for (const t of fresh) {
      await db.rpc('pa_claim_contact_thread', { p_contact_id: o.id, p_thread_id: t })
    }
    if (fresh.length) console.log(`  ↳ 账本里翻出 ${fresh.length} 条没登记过的往来（没花模型）`)
    return [...have, ...fresh]
  }

  // ── 机会线：照旧。登记过就不再找。 ──
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

// ── 这个地址是谁 ───────────────────────────────────────────────
//
// 加人这件事原来是让你填表：名字、邮箱、机构，一格格敲。后来改成让你从
// 下拉框里挑「这是谁」。**两个都错**——几千个联系人的时候你挑不动，
// 而且这些答案**信里全都有**：签名里有名字和网站，正文里有机构和头衔，
// 主题行里常常写着谁介绍的。
//
// 该干这活的是它，不是你。你只负责点头。
//
// 三条护栏：
//   · 认不出就说认不出（kind:'unknown'），不编一个人出来
//   · 共享信箱要认出来（residency@ / workshops@ / info@，署名是一组人）——
//     它不是人，硬当成人就是 0033 犯过的错
//   · **只提议，不写库**。写库是前端拿着你的点头去调 RPC。
//     认错人比不认更麻烦，所以这一步永远留一个人的判断。
async function handleIdentify(body) {
  const email = String(body?.email || '').trim().toLowerCase()
  if (!email.includes('@')) throw new Error('要一个邮箱地址')

  // 通讯录现状喂给它，好让它认出「这是某人的另一个邮箱」
  const { data: known } = await db.rpc('pa_address_book_digest')
  const { data: prof } = await db.from('v_pa_profile').select('*').limit(1)
  const profile = prof?.[0] || null

  const { text } = await think(
    `查清 ${email} 这个地址背后是谁。

先用 mcp__claude_ai_Gmail__search_threads 搜 \`from:${email} OR to:${email}\`，
再用 get_thread 读最近那一两条（要正文——签名在正文里）。

【已经在通讯录里的人】
${(known || []).map((k) => `- ${k.name}｜邮箱：${(k.emails || []).join(', ') || '（无）'}｜机构：${k.org || '（无）'}`).join('\n') || '（通讯录是空的）'}

【已经登记的机构共享信箱】
${(known || []).flatMap((k) => k.mailboxes || []).join(', ') || '（还没有）'}

要判断三件事：

**一、这是人还是机构的共享信箱？**
共享信箱的样子：地址像 residency@ / workshops@ / info@ / hello@，
署名是一组人（"Mattie, Billy, and Joo"），或者口气是机构而不是某个人。
**它不是人。** 认成人的话往来会归错到某个倒霉蛋头上。

**二、如果是人，他是不是上面那份名单里已有的某位？**
常见情形：他换了邮箱（信里可能明说 "I've changed to…"、或者旧地址的告别信里
留了新地址）。名字对得上、或者同一个机构同一件事在接着聊，就算命中。
**名字像但机构和事情都对不上的，不算**——那多半是两个人。

**三、如果是新人，从信里能认出什么？**
名字（签名）、机构、他管什么、个人网站、**谁介绍的**（主题行和正文第一句常有）。
认不出的字段就留空，别编。

**最后一行**单独输出，别的什么都不要加：
[[WHO]] {"kind":"person|shared_box|unknown","name":"…","org":"…","role":"…","site":"…","intro_by":"…","notes":"中文，两三句说清这段关系是怎么回事、他最近说了什么、下一步该干嘛","match_name":"命中通讯录里哪位，没有就 null","match_why":"…","threads":["thread id"],"confidence":"high|low"}

字段没有就用 null。**认不出来就 kind:"unknown"，别硬凑一个人出来。**`,
    GMAIL_TOOLS,
    profile,
  )

  const m = text.match(/\[\[WHO\]\]\s*(\{[\s\S]*?\})\s*$/m)
  let who = null
  try { who = m ? JSON.parse(m[1]) : null } catch (_) { who = null }
  if (!who) return { email, kind: 'unknown', note: '没认出来（它没按格式回话）' }
  return { email, ...who }
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
· counterpart   **对面那个地址**（纯地址，不要名字不要尖括号）。
                他发来的信 = From 那个；你发出去的信 = To 那个。
                一句话：**永远不是 ${mailboxOf(ctx.profile) || '你自己'}**。
                这一栏是归属的唯一判据——没有它，这封信就只能靠猜是谁的，
                而猜正是 0033 犯过的错（Stacy 的告别信被记到了别人卡上）。
· raw          正文纯文本（**原样**，不要摘、不要改）
· summary      一句中文摘要，说清这封信要什么或给了什么

**最后一行**单独输出，别的什么都不要加：
[[MAIL]] {"messages":[{"id":"…","role":"org","at":"…","subject":"…","from":"…","counterpart":"…","raw":"…","summary":"…"}]}
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
  // 入库走 pa_add_mail：**brain 不判断这封信是谁的**，它只把信头照抄进来，
  // 归属由那个函数查 contact_emails / org_mailboxes 算出来。
  //
  // 这是 0033 那个 bug 的结构性药方。当时的判据是「这条线挂了谁，信就都是谁的」，
  // 于是 Mattie 名下 13 封里只有 1 封真是她的。判据只能是信头上的地址。
  //
  // 认不出来的地址也照样入库（0043 放宽了约束）——它会出现在
  // 「还不认识的地址」里等你认，那不叫无主，叫待认领。为了守一条护栏
  // 把信丢在门外，本末倒置。
  let unknown = 0
  for (const mail of parsed.messages || []) {
    if (!mail?.id || !mail?.role) continue
    const cp = String(mail.counterpart || '').trim().toLowerCase()
    if (!cp.includes('@')) {
      // 没给地址就不写——宁可这一封没进来，也不要它进来之后归错人。
      console.warn(`  ⚠️ ${mail.id} 没报对面地址，这封先不入库`)
      continue
    }
    const { data, error } = await db.rpc('pa_add_mail', {
      p_gmail_message_id: mail.id,
      p_counterpart: cp,
      p_role: mail.role === 'artist' ? 'artist' : 'org',
      p_content: mail.summary || (mail.raw || '').slice(0, 200),
      // 收一条**线**的信就挂那条线；收一个**人**的信没有线可挂，
      // 归属完全由地址决定（他自己那几封会认到他头上）。
      p_pursuit_id: owner.kind === 'pursuit' ? owner.id : null,
      p_body_raw: mail.raw || null,
      p_meta: { subject: mail.subject || null, from_name: mail.from || null },
      p_created_at: mail.at || null,
    })
    if (error) { console.warn('  ⚠️ 一封没写进去：' + error.message); continue }
    if (data?.owner === 'unknown') unknown++
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
  // unknown = 这一轮里地址还没登记的那几封，它们会出现在「还不认识的地址」等你认。
  if (unknown) console.log(`  ↳ 其中 ${unknown} 封的地址还不认识，去人际管理页认一下`)
  return { ok: true, threads: threads.length, added, addedIn, unknown }
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
// 人的「收信」按钮：**把他名下还没搬的信全补上。**
//
// 这条路一次 agent 都不走。以前它走 handleSync，那意味着让模型去 Gmail
// 逐条读 thread —— 20 条 thread 读一遍要好几分钟，而且 59 封信一封不缺时
// 也照读不误。找信是机械活，凭什么花模型。
//
// 现在的三步全是死的：
//   ① 他有哪些地址          contact_emails，一次 SQL
//   ② 那些地址下哪些信没搬   pa_mail_promote 查信头账本，一次 SQL
//   ③ 拉正文、写进对话表     纯 HTTP + pa_add_mail（归属自己按地址算）
//
// 唯一过模型的是「给新搬进来的信写一句摘要」，8 封一批，而且**只摘新增的**——
// 没有新信就一次都不花。摘要写不成也不算失败：退回正文首段，绝不留空。
//
// 去 Gmail 抓新信是 mail/loop.js 每 5 分钟干的事，这个按钮不重复那件事。
// 它只负责「账本里已经有的，搬进这张卡」。
async function handlePersonRefresh(contactId) {
  const { data: rows, error: ee } = await db
    .from('v_pa_contact_emails').select('email').eq('contact_id', contactId)
  if (ee) throw new Error('读他的地址失败：' + ee.message)
  const addrs = (rows || []).map((r) => r.email).filter(Boolean)
  if (!addrs.length) {
    return { ok: true, added: 0, addedIn: 0, threads: 0,
      note: '这个人名下一个邮箱都没登记，所以没处补。先在名片上填个地址。' }
  }

  let added = 0
  const threads = new Set()
  const notes = []
  for (const a of addrs) {
    try {
      const out = await promote(a, { log: (m) => console.log(m) })
      added += out.added || 0
      for (const t of out.threads || []) threads.add(t)
    } catch (err) {
      // 一个地址挂了不该带垮别的地址 —— 说出来，接着补下一个
      notes.push(`${a}：${err.message}`)
      console.warn(`  ⚠️ ${a} 没补成：${err.message}`)
    }
  }

  // 认领 thread：名片上「认领了几条」要跟着走，以后别的路子也认得回来
  for (const t of threads) {
    try { await db.rpc('pa_claim_contact_thread', { p_contact_id: contactId, p_thread_id: t }) }
    catch (_) {}
  }

  return {
    ok: true, added, addedIn: added, threads: threads.size,
    addrs: addrs.length,
    // 说实话，包括「一封都没有」——静默是最坏的，你会分不清它查过了还是没查
    note: notes.length ? notes.join('；')
      : added ? null
      : '账本里没有还没搬的信。新信由后台每 5 分钟自己收。',
  }
}

/**
 * 判断用的 system —— **跟 Fairwind 那套人格无关**。
 *
 * 判「这段交流约定了下一个时间点吗」「这封信要不要回」，不需要知道
 * 你有哪些作品、履历长什么样、协作弧怎么走、写信有什么规矩。
 * 带着那些只是白付上下文钱。
 *
 * 工具也一个不给：这两件事全在给它的文字里，不需要联网。
 */
const JUDGE_SYSTEM = `你在读一段真实的邮件往来，替一位艺术家做一个很小的判断。

规矩：
- 只回答被问到的那几个问题，不展开、不建议、不客套。
- 依据只能是给你的这些文字。**看不出来就答 null**，不要推测。
- 最后一行按要求输出那个标记块，别的什么都不要加。`

/**
 * 重判一批对象。**路由和收信循环共用这一份** ——
 * 手动「接着判」和自动那一轮不该是两套代码。
 */
async function rejudgeThese(want) {
  if (!want?.length) return { judged: 0, failed: 0, touched: 0 }

  const { data: subjects, error: se } = await db.rpc('pa_subjects_for_rejudge', {
    p_kinds: want.map((x) => x.kind), p_ids: want.map((x) => x.id),
  })
  if (se) throw new Error('取近况失败：' + se.message)
  if (!subjects?.length) return { judged: 0, failed: 0, touched: 0 }

  const t = new Date().toLocaleTimeString('zh-CN')
  console.log(`\n→ ${t} 重判 ${subjects.length} 个对象`)
  const { text } = await think(rejudgePrompt(subjects), [], JUDGE_SYSTEM, null, null, null, 1)
  const byId = Object.fromEntries(parseRejudge(text).map((v) => [v.id, v]))

  let judged = 0, touched = 0
  for (const w of want) {
    const v = byId[`${w.kind}:${w.id}`]
    // 没判出来的**不推水位** —— 下次再判。绝不许假装判过了。
    if (!v) continue

    // 日期和出处成对才写；两个都 null = 把旧的那条作废掉
    // （它已经过期了，而这段交流没有约定新的）。
    const { error: te } = await db.rpc('pa_set_next_touch', {
      p_kind: w.kind, p_id: w.id, p_at: v.touch, p_why: v.why,
    })
    if (!te && v.touch) touched++

    // 最后那封来信要不要回，顺手落进 letter_verdicts（跟 triage 同一张表）
    if (w.last_in_id) {
      await db.rpc('pa_judge_letter', {
        p_gmail_message_id: w.last_in_id, p_needs_reply: v.needs_reply,
        p_not_before: null, p_why: v.reply_why,
      })
    }

    // 「上次碰」也是从信推出来的派生值，同样会跟事实分叉。重判到谁就重算谁。
    await db.rpc('pa_recompute_touch', { p_kind: w.kind, p_id: w.id })

    const { data } = await db.rpc('pa_mark_judged', {
      p_kind: w.kind, p_id: w.id, p_upto: w.upto || new Date().toISOString(),
    })
    if (data) judged++
  }
  const out = { judged, failed: want.length - judged, touched }
  console.log(`  \u21b3 ${JSON.stringify(out)}`)
  return out
}

/** 判一批信「要不要回」。跟重判一样，路由和循环共用。 */
async function triageThese(ids) {
  if (!ids?.length) return { judged: 0, failed: 0 }
  const { data: letters, error: le } = await db.rpc('pa_letters_for_triage', { p_ids: ids })
  if (le) throw new Error('取信失败：' + le.message)
  if (!letters?.length) return { judged: 0, failed: 0 }

  const t = new Date().toLocaleTimeString('zh-CN')
  console.log(`\n→ ${t} 判 ${letters.length} 封信要不要回`)
  const { text } = await think(triagePrompt(letters), [], JUDGE_SYSTEM, null, null, null, 1)
  let judged = 0
  for (const v of parseTriage(text)) {
    const { data } = await db.rpc('pa_judge_letter', {
      p_gmail_message_id: v.id, p_needs_reply: v.needs_reply,
      p_not_before: v.not_before, p_why: v.why,
    })
    if (data) judged++
  }
  const out = { judged, failed: letters.length - judged }
  console.log(`  \u21b3 ${JSON.stringify(out)}`)
  return out
}

// ── 新事实过转移表 ────────────────────────────────────────
//
// 一格一个问题：问什么取决于当时的 state 和来的 event（brain/judge.js
// 顶上那段）。每条事实一次调用 —— 量按新事实数走，平时一轮 0～2 条。
//
// **state 每条现读**：上一条的标签会改这一条的 state，所以只能按时间
// 正序一条条来（pa_facts_to_judge 排好了序）。
//
// **跳过要出声**：静默的跳过跟「判过了」长得一样 —— 这次重做的起因
// 之一就是「判不出来时的跳过完全无声」。
async function tagPass({ limit = 12 } = {}) {
  let facts = []
  try {
    ;({ data: facts } = await db.rpc('pa_facts_to_judge', { p_limit: limit }))
  } catch (err) { console.error('✗ 取待判事实：', err.message); return { tagged: 0 } }
  if (!facts?.length) return { tagged: 0 }

  const t = new Date().toLocaleTimeString('zh-CN')
  console.log(`\n→ ${t} ${facts.length} 条新事实过转移表`)
  let tagged = 0
  const skipped = []
  for (const f of facts) {
    const ev = eventOf(f)
    if (!ev) { skipped.push(`${f.subject_name}：kind=${f.kind} 不是 event`); continue }

    let st = null
    try {
      const { data } = await db.from('v_pa_state').select('*')
        .eq('subject_kind', f.subject_kind).eq('subject_id', f.subject_id).maybeSingle()
      st = data
    } catch (_) {}
    const stateName = st?.state || 'IDLE'

    const cell = cellFor(stateName, ev)
    if (!cell) { skipped.push(`${f.subject_name}：${stateName} x ${ev} 表里没这格`); continue }

    let tag = null
    if (cell.rule) {
      tag = cell.rule(f)          // 纯规则格，不花钱
    } else {
      try {
        const { text } = await think(cell.ask(f, st), [], JUDGE_SYSTEM, null, null, null, 1)
        tag = parseTag(text)
      } catch (err) { skipped.push(`${f.subject_name}：${err.message}`); continue }
    }
    // 没判成不写标签 —— 标签的存在 = 「判过了」，假装判过比不判坏
    if (!tag) { skipped.push(`${f.subject_name}：${stateName} x ${ev} 没按格式回话，下轮再来`); continue }

    const { error } = await db.rpc('pa_tag_message', {
      p_message_id: f.id, p_situation: `${stateName} x ${ev}`,
      p_resolves: tag.resolves, p_resolves_why: tag.resolves_why,
      p_needs_reply: tag.needs_reply, p_reply_why: tag.reply_why,
      p_awaiting: tag.awaiting, p_wait_days: tag.wait_days,
      p_meet_at: tag.meet_at, p_gist: tag.gist,
    })
    if (error) { skipped.push(`${f.subject_name}：写标签失败 ${error.message}`); continue }
    tagged++

    // 「谢过了」的落笔处不是标签：owe_thanks 的关法是 contacts.intro_thanked_at
    // （0097）。判到 resolves 就把这个介绍人名下没谢过的一次性标掉 ——
    // 一封谢信提几个人，就是一次谢几条。
    if (stateName === 'OWE_THANKS' && tag.resolves) {
      const { data: n } = await db.rpc('pa_thank_introducer', { p_introducer: f.subject_id })
      if (n) console.log(`  · 谢过了：${f.subject_name} 名下 ${n} 条介绍标为已谢`)
    }
  }
  if (skipped.length) console.log(`  · 跳过 ${skipped.length} 条：${skipped.join('；')}`)
  console.log(`  ↳ ${JSON.stringify({ tagged, skipped: skipped.length })}`)
  return { tagged, skipped: skipped.length }
}

// ── 到点才动笔 ────────────────────────────────────────────
//
// 每轮扫「到点了的」（pa_due_actions）。**判断出来不起草，到点才起草**：
// 等 5 天的那封第 5 天才动笔，中间对方回了，这次调用（带全卡上下文，
// 全系统最贵的一种）就省了。
//
// 去重靠 meta.timer.key（state:subject:since 那天）：同一个等待动一次，
// 等待换了（新 since_at）才再动。范围闸在 SQL 里：线都自动，
// 人只对 2026-08-03 之后建的。
const TIMER_CAP = 4   // 一轮最多起草几封 —— 别让重放完的第一轮憋出十几封

async function timerPass({ cap = TIMER_CAP } = {}) {
  let rows = []
  try { ;({ data: rows } = await db.rpc('pa_due_actions')) }
  catch (err) { console.error('✗ 取到点的：', err.message); return { acted: 0 } }

  const todo = (rows || []).filter((r) => !r.acted && r.allowed)
  const gated = (rows || []).filter((r) => !r.acted && !r.allowed)
  if (gated.length) console.log(`  · ${gated.length} 条到点但没开自动起草（开工前的老联系人）：${gated.map((r) => r.subject_name).join('、')}`)
  if (!todo.length) return { acted: 0 }

  const t = new Date().toLocaleTimeString('zh-CN')
  console.log(`\n→ ${t} ${todo.length} 条到点了`)
  let acted = 0
  for (const r of todo.slice(0, cap)) {
    let say = timerDirective(r)
    if (!say) continue                    // 见面当天早上：通知栏的事，不动笔

    // 合并规则（设计稿第六节）：同一个人跨两张卡都到点了 → 由起草这次调用
    // 判「等一起发还是先发一封」，别机械地各起各的。
    if (r.subject_kind === 'contact') {
      const 同人线 = todo.filter((x) => x !== r && x.contact_ids?.includes(r.subject_id))
      if (同人线.length) {
        say += `\n\n注意：这个人同时还挂在到点的机会线上（${同人线.map((x) => `「${x.subject_name}」${x.state}`).join('、')}）。按惯例判断：这封该**并进那边一起说**，还是**单独先发**？该并的话别起草，直接一句话说明并给哪张卡。`
      }
    }
    const owner = r.subject_kind === 'pursuit'
      ? { pursuit_id: r.subject_id } : { contact_id: r.subject_id }
    try {
      const ctx = await loadOwnerContext(owner)
      console.log(`  · ${r.subject_name}：${r.state}（过了 ${r.days_over} 天）`)
      const { text: reply } = await think(
        buildUser(ctx, say, null), READ_TOOLS, buildSystem(ctx), null, null, null,
      )
      const one = extractLetter(reply)
      await addMessage(owner, 'producer', one.clean, 'message', {
        ...(one.letter ? { letter: one.letter } : {}),
        timer: { key: timerKey(r), state: r.state },
      })
      acted++
    } catch (err) { console.error(`  ✗ ${r.subject_name} 这条没动成：${err.message}`) }
  }
  if (todo.length > cap) console.log(`  · 还有 ${todo.length - cap} 条排到下一轮（一轮最多 ${cap} 封）`)
  console.log(`  ↳ ${JSON.stringify({ acted })}`)
  return { acted }
}

// ── 脏了就判 ──────────────────────────────────────────────
//
// 一批最多带多少 —— **这不是为了省钱，是为了别让单次调用太大**。
//
// 这儿一度有一套「攒够 6 个或 60 分钟才判」的逻辑，为的是省订阅额度
// （每次调用有个跟内容无关的底价）。撤掉了：SDK 这条路本来就是临时的，
// 而额度现在够用。**省额度是拿「🔔 上那个数字能错多久」换的，
// 不该拿它换。**
const BATCH_CAP = 30

async function judgePass({ subjects = BATCH_CAP, letters = 20 } = {}) {
  const out = { rejudged: 0, triaged: 0 }
  let stale = [], ids = []
  try {
    ;({ data: stale } = await db.rpc('pa_stale_subjects', { p_days: 30, p_limit: subjects }))
    ;({ data: ids } = await db.rpc('pa_letters_to_triage', { p_limit: letters }))
  } catch (err) { console.error('✗ 取待判：', err.message); return out }

  try { if (stale?.length) out.rejudged = (await rejudgeThese(stale)).judged }
  catch (err) { console.error('✗ 重判：', err.message) }
  try { if (ids?.length) out.triaged = (await triageThese(ids)).judged }
  catch (err) { console.error('✗ 判信：', err.message) }
  return out
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

  if (req.method === 'GET' && req.url === '/health') {
    // 邮件那一轮的状态跟着 /health 走：界面每 8 秒本来就在问它，
    // 不用再多开一个口，也不会出现「界面以为在收、其实早停了」。
    const { lastSweep } = await import('./mail/loop.js')
    return send(res, 200, { ok: true, build: BRAIN_BUILD, mail: lastSweep() })
  }

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

  // 同一件事，只是边想边吐字。跟 /chat 共用 handleChat —— 不复制一份业务逻辑，
  // 复制了两条路早晚走岔（一条落了库另一条没落，这种岔子最难发现）。
  //
  // /chat 没有下岗：群发是对 N 条线并行说同一句，没有哪条时间线能流给你看。
  if (req.method === 'POST' && req.url === '/chat/stream') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      // 界面那头断了写不进去是常事（关页面、切走）。写不进去不该往上抛：
      // 这一轮还得想完、还得把回复落库——没人看着不等于这次活白干。
      const frame = (o) => {
        if (res.writableEnded || res.destroyed) return
        try { res.write(`data: ${JSON.stringify(o)}\n\n`) } catch (_) {}
      }
      let body = {}
      try {
        body = JSON.parse(raw || '{}')
        console.log(`\n→ ${new Date().toLocaleTimeString('zh-CN')} 来自 ${origin || '(无 origin)'}（流）`)
        console.log(`  ${String(body.text).slice(0, 50)}`)
      } catch (err) {
        frame({ t: 'error', error: '请求读不动：' + err.message })
        return res.end()
      }

      // 你把页面关了 / 切走了：这一次也掐掉。不掐的话它继续想完、继续写库，
      // 而没有任何人在等这份回复。
      let done = false
      res.on('close', () => {
        if (done || !body.run_id) return
        const ac = RUNS.get(body.run_id)
        if (ac) { console.log('  ↳ 界面断了，掐掉这一次'); ac.abort(); RUNS.delete(body.run_id) }
      })

      try {
        const out = await handleChat(body, frame)
        done = true
        frame(out.aborted ? { t: 'done', aborted: true } : { t: 'done', reply: out.reply })
      } catch (err) {
        done = true
        console.error('✗', err.message)
        frame({ t: 'error', error: err.message })
      }
      res.end()
    })
    return
  }

  if (req.method === 'POST' && req.url === '/chat/stop') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}')
        console.log(`\n→ 终止 ${body.run_id}`)
        send(res, 200, handleStop(body))
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

  if (req.method === 'POST' && req.url === '/identify') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}')
        console.log(`\n→ ${new Date().toLocaleTimeString('zh-CN')} 认人 ${body.email}`)
        const out = await handleIdentify(body)
        console.log(`  ↳ ${out.kind}${out.name ? ' · ' + out.name : ''}${out.match_name ? ' → 命中 ' + out.match_name : ''}`)
        send(res, 200, out)
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

  // ── 邮件：全局同步那一套 ──────────────────────────────────────
  //
  // 这几个口的活儿浏览器干不了：认领要去 Gmail 拉正文、要让模型写摘要。
  // 但它们跟上面那些不一样——**代码机械拉，模型只碰该碰的那一步**，
  // 逻辑全在 mail/ 底下，这儿只是转发。
  if (req.method === 'POST' && (req.url === '/mail/adopt' || req.url === '/mail/sync')) {
    const isAdopt = req.url === '/mail/adopt'
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}')
        const t = new Date().toLocaleTimeString('zh-CN')
        let out
        if (isAdopt) {
          const { adoptPerson, adoptOrgMailbox } = await import('./mail/adopt.js')
          console.log(`\n→ ${t} 认领 ${body.email}（${body.kind === 'org' ? '机构信箱' : '人'}）`)
          out = body.kind === 'org'
            ? await adoptOrgMailbox(body.email, { org: body.org, notes: body.why })
            : await adoptPerson(body.email, {
                contactId: body.contact_id || null, name: body.name,
                org: body.org, role: body.role, notes: body.why,
              })
        } else {
          const { incremental } = await import('./mail/sync.js')
          console.log(`\n→ ${t} 收全局新信`)
          out = await incremental()
        }
        console.log(`  ↳ ${JSON.stringify(out)}`)
        send(res, 200, out)
      } catch (err) {
        console.error('✗', err.message)
        // 授权掉了要认得出来，不能长成「这轮 0 封新信」——那正是这次事故里
        // 最伤人的失败形态。前端拿 needs_auth 弹一句人话。
        send(res, 500, { error: err.message, needs_auth: err.name === 'MailAuthError', fix: err.fix || null })
      }
    })
    return
  }

  // ── 判一批信要不要回 ─────────────────────────────────────────
  //
  // 懒算：**不在收信时判**。incremental() 是纯收信，往里加模型调用会让
  // 全局同步变慢变贵，而且你不看的信也要付钱。改成通知栏打开时判一批。
  //
  // 判哪些：由前端点名（它知道哪些是「此刻会成为候选的最后一封来信」），
  // 量锁在「你有多少个对象」这个数量级上（几十），不是「你收过多少封信」（几千）。
  //
  // 设计稿：docs/specs/2026-08-18-notifications-design.md 第五节
  if (req.method === 'POST' && req.url === '/letters/triage') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const ids = (JSON.parse(raw || '{}').ids || []).filter((x) => typeof x === 'string')
        if (!ids.length) return send(res, 200, { judged: 0, failed: 0 })

        // 走 RPC 不走 db.from：**producer schema 没进 Exposed schemas**
        // （第 60 行那条规矩）。直接 from('pursuit_messages') 打的是
        // public 里那张不存在的表，回空数组还不报错 —— 长成「这批没什么
        // 可判的」，是最难查的那种失败形态。
        send(res, 200, await triageThese(ids))
      } catch (err) {
        console.error('✗', err.message)
        send(res, 500, { error: err.message })
      }
    })
    return
  }

  // ── 重判一批对象 ─────────────────────────────────────────────
  //
  // 在这之前**没有任何时刻会发生重判**：写 next_touch_at 的 handleRefresh
  // 是死代码，于是库里那几个日期是历史遗留。结果就是通知栏拿着陈旧的结论
  // 说话——Sarah 早就回过「plan on 2027」，它还在报老账。
  //
  // 懒算，跟判信同一条道理：**不看就不花钱**。前端点名脏了的那些
  // （stale = 最后一件事晚于上次重判的水位），一批一批判过去。
  //
  // 设计稿：docs/specs/2026-08-19-rejudge-design.md
  if (req.method === 'POST' && req.url === '/subjects/rejudge') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const want = (JSON.parse(raw || '{}').subjects || [])
          .filter((x) => x && (x.kind === 'contact' || x.kind === 'pursuit') && x.id)
        send(res, 200, await rejudgeThese(want))
      } catch (err) {
        console.error('✗', err.message)
        send(res, 500, { error: err.message })
      }
    })
    return
  }

  // ── 发信 ──────────────────────────────────────────────────────
  //
  // **这个口不在模型的工具白名单里**，只有页面上那颗按钮能触发它。
  // 「Fairwind 写得出信，但按不了发送键」那句话就是靠这一条兑现的。
  if (req.method === 'POST' && req.url === '/mail/send') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}')
        console.log(`\n→ ${new Date().toLocaleTimeString('zh-CN')} 发信 ${body.contact_id ? `人 ${body.contact_id}` : body.pursuit_id}`)
        const out = await handleSendMail(body)
        console.log(`  ↳ 出去了 ${JSON.stringify(out)}`)
        send(res, 200, out)
      } catch (err) {
        console.error('✗', err.message)
        send(res, 500, { error: err.message, needs_auth: err.name === 'MailAuthError', fix: err.fix || null })
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

  // 邮件那一轮。**它是这个系统里唯一会去 Gmail 拿信的东西**——
  // 在这之前收信完全靠人记得按按钮，于是 8/11 那批信在库外躺了七小时。
  // 判错还能查，没去拿是查不出来的：界面上「没有新信」和「根本没收」
  // 长得一模一样。
  //
  // 五分钟一轮：新信几乎不花钱（纯 HTTP + 纯 SQL），只有真冒出新地址
  // 或者真有孤儿来信时才动模型。
  const mailLoop = async () => {
    try {
      const { sweepMail } = await import('./mail/loop.js')
      await sweepMail()
      // 新事实先过转移表（一格一问，state 按事件顺序推进）……
      await tagPass()
      // ……再把脏了的判掉。**不等你打开通知栏** —— 见 judgePass 上面那段。
      await judgePass()
      // 最后看谁到点了 —— 起草、发问，都只在这一刻发生
      await timerPass()
    } catch (err) { console.error('  ✗ 邮件循环起不来：' + err.message) }
  }
  setTimeout(mailLoop, 5000)          // 起来 5 秒后先跑一轮，别让你等五分钟
  setInterval(mailLoop, MAIL_MS)
  console.log(`   邮件：每 ${Math.round(MAIL_MS / 60000)} 分钟收一次新信（这是唯一会去 Gmail 拿信的地方）`)
})
