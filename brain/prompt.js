// 拼 prompt。**只有纯函数**——不碰库、不碰网、不起服务，所以测得了。
//
// 为什么单独一个文件：这些函数原来长在 server.js 里，而那个文件顶层就
// server.listen()，`import` 一下服务就起来了，于是「拼出来的 prompt 对不对」
// 这件事一行测试都写不了。搬出来之后 prompt.test.js 能把它按住。
//
// ── 三档切法（2026-08-15）────────────────────────────────────
//
// 提示词缓存是**前缀匹配**：从第一个字起逐字相同才能接着用，中间断一个字，
// 后面全部全价重读。而服务器只在几个指定位置存状态（断点），Claude Code 放三处：
// systemPrompt 末尾、工具定义末尾、消息数组末尾。
//
// 原来所有东西拼成一根字符串当**唯一一条 user message** 发出去，于是断点只能
// 落在这条消息的末尾——而末尾是「Ta 刚说」，每次都变。断点作废，它前面那
// 六万多字符（含两万多的信息库）每次全价重读。能省的东西全放在了省不了的地方。
//
// 现在按「变不变」切三档：
//
//   fixed   永不变（人格 + 档案 + 战绩信息库）  → systemPrompt 静态块，跨会话缓存
//   ───────  SYSTEM_PROMPT_DYNAMIC_BOUNDARY ───────
//   perLine 每条线不同、但一次会话内不变（文件清单 + 卡上字段） → systemPrompt 动态块
//   talk    对话本身（往来 + 你刚说的那句）     → user message，末尾本来就该变
//
// **一个字都没搬丢**：promptLines() 就是这三档首尾相接，prompt.test.js 拿一份
// 老 buildPrompt 的逐字复刻当尺子比对。改这里任何一段，测试都会红。
//
// 三件故意不做的事（见 docs/specs/2026-08-15-prompt-cache-split-design.md）：
// · 往来不搬进 systemPrompt——它每句都在长，塞进去会让唯一还稳的那块每轮都变。
// · 收尾句「回应 ta……」留在 user message 末尾——紧贴问题的位置是有用的。
// · 五处后台活儿（收信/认人/查 thread/消化/建草稿）继续走老路子，不带信息库。

import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk'
import { isImage, IMG_CAP } from './files.js'

export { SYSTEM_PROMPT_DYNAMIC_BOUNDARY }

// 「你服务的谁」是**数据**，不是常量。原来这儿写死着 "Hu Di / hudiworks.com"，
// 而同一批事实在 producer.profile 里也存着一份 —— 两份会飘，而且改的时候只有
// 开 SQL 一条路。现在只有库里那一份是真的；这里每次开工现读。
//
// 读不到就退回一句不认人的话：宁可它说"这位艺术家"，也不要它张口就叫错名字。
// 档案里没填就退回不认人的说法 —— 宁可说「这位艺术家」，也不要编一个。
export const artistOf  = (profile) => profile?.name || '这位艺术家'
export const idOf      = (profile) => {
  const d = profile?.data || {}
  const loc = Array.isArray(d.location) ? d.location.join(' / ') : d.location
  return [d.visa, loc && `常住 ${loc}`].filter(Boolean).join('，')
}
export const mailboxOf = (profile) => profile?.data?.email || null

// 写完一封信要报一声，否则它写的信只能靠人从气泡里选中、复制、粘去 Gmail。
//
// ── 这条规矩要求它判断什么 ──────────────────────────────────
// **只判断形式**：我这次写的是不是一封能直接发出去的信（有收件人、有主题、
// 有称呼和落款）。这件事它写的时候本来就知道，不用猜。
//
// **不判断「这封该不该发」。** 那是他在页面上点「收进产出」那一下。
// 刀切在这儿，「AI 判断得准不准」就不再是风险：它最多把一段语气示范也标成信，
// 代价是产出栏多一份随手删掉的草稿——不是发错信。
//
// 放在 systemFor 里（静态块）是因为它永不变，跟着跨会话的缓存走。
const LETTER_RULE = `## 写信的时候

只有当你**真的写了一封可以直接发出去的信**（有收件人、有主题、有称呼和落款）时，
在整段回复的**最后一行**单独加上这一行，别的什么都不要加：

[[LETTER]] {"to":"收件人地址","subject":"主题","summary":"一句话说清这封信在说什么","body":"信的全文","reply_to":"回的那封信的 Message-ID，没有就 null","thread_id":"Gmail threadId，没有就 null"}

- **信的全文放进 body，上面的话里不要再写一遍。** 上面那段留给你对他说的话
  （「我起了一版，你看看第二段的语气」），信本身归 body。两处都写的话，
  他改了上面那份、发出去的却是 body 那份——而他不会察觉。
- body 是一个 JSON 字符串：换行写成 \\n，引号记得转义。
- 只是在讨论「这封信该怎么写」、给一段语气示范、列几条要点——**都不要加这一行**。
- 收件人 to 填**主要那一个**（一般是你回的那封信的发件人）。抄送、以及原信上
  其他收件人**不用你操心**——他在页面上会看到从信头账本里算出来的完整名单，
  自己勾。你猜一份名单出来反而会盖掉真的那份。
- summary 会被原样记进往来里当那一行摘要，用中文，二十来字。`


// 填表也要报一声，理由跟写信一样：不报的话，它逐条写出来的答案只能靠人
// 从气泡里一条条选中复制，而**每条各有各的字数上限**，复制的过程中那个
// 上限就丢了 —— 你会在提交前一刻才发现某一格超了 40 个词。
//
// 逐格的闸是这件事的全部意义所在（rules.js 早就会数，缺的只是拆到每格）。
// 所以这条规矩里最要紧的一句是「字数照抄机构原文，别自己定一个」：
// 它自己编一个上限，比没有上限更坏 —— 你会照着那个假上限去改。
const FORM_RULE = `## 填申请表的时候

他贴进来一张表的条目、让你逐条写，写完在整段回复的**最后一行**单独加上这一行：

[[FORM]] {"title":"这张表是什么（机构 + 用途）","fields":[{"q":"题目原文","words":[下限,上限],"a":"你写的答案"}]}

- 每一格的字数限制**照抄机构原文**：说 "max 300 words" 就写 "words":[0,300]，
  说 "1000–1500 characters" 就写 "chars":[1000,1500]。**没说就不写这一项**——
  你自己定一个上限比没有上限更坏，他会照着那个假的去改。
- 题目 q 用**原文**（英文表就写英文），别翻译——他要照着往网页表单里填。
- 一次把整张表的所有格子都放进 fields 里，别分几轮。
- 只是在讨论这张表该怎么答、还没真写答案时，**不要加这一行**。

`

export const systemFor = (profile) => {
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

你不能做的：你改不了这条线的阶段、也改不了作品盒子。要动这些，说出来让 ta 点。

${LETTER_RULE}

${FORM_RULE}`
}

// 履历那些「一条」的关键事实——学校名、机构、起止年份、地点——存在 meta 这个
// jsonb 里，不是表上的列。所以这里必须按 kind 摊开：不摊，education / credit / job
// 在 prompt 里就只剩一个光秃秃的标题，Fairwind 会如实汇报「你档案里没有这些」，
// 而界面上明明白白写着。（这已经害过一次：它跟 Hu Di 说「教育那栏空得有点厉害」。）
//
// 界面上那份对应实现是 src/data/schema.js 的 subInfo()——改一边记得改另一边。
// 故意没有共用一份：brain 是独立进程，跨包 import 前端源码是另一件事；而且两边
// 需求不同（见下面 credit 那条）。
//
// 注：原来还有一条理由是「import 会连 57 条种子数据一起拖进来」——
// 2026-08-13 骨架/血肉分家之后那条不成立了，schema.js 里一条内容都没有。
// 要不要合成一份是独立的一刀，见 docs/specs/2026-08-13-skeleton-and-flesh-design.md 第九节。
export function entryFacts(e) {
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
export function entriesBlock(entries) {
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

// prompt 里那份清单：只有名字/类型/多大/哪来的，**没有内容**。
export function filesBlock(atts) {
  if (!atts?.length) return []
  const lines = ['## 这条线上的文件']
  let anyImage = false
  for (const a of atts) {
    const img = isImage(a.filename, a.mime)
    if (img) anyImage = true
    const size = a.bytes ? `${(a.bytes / 1024).toFixed(0)} KB` : ''
    // 标出哪份是图：不标的话「按需开」是句空话——它得先知道哪几份开起来是贵的
    const bits = [img ? '图' : '', size, a.source === 'mail' ? '从一封信的附件来' : '他传的']
      .filter(Boolean).join(' · ')
    lines.push(`- ${a.filename}${bits ? `（${bits}）` : ''}`)
  }
  lines.push('要看里面写了什么，用 open_file 开。别猜内容——没开过就说没看过。')
  if (anyImage) {
    lines.push(`标了「图」的那几份你能直接看见，但它们进来就一直占着上下文、每一轮都重付——只在真需要看图里的东西时才开，一条对话最多 ${IMG_CAP} 张。`)
  }
  lines.push('')
  return lines
}

// ── 一段一段的料 ────────────────────────────────────────────
// 每一段都返回**行数组**，不返回拼好的字符串。三档就是这些数组的分组，
// 老 buildPrompt 就是它们首尾相接——这样「搬家有没有丢字」是能逐行比对的。

const fact = (k, v) => (v ? `${k}：${v}\n` : '')

const profileBlock = (profile) =>
  profile ? ['## 关于这位艺术家', JSON.stringify(profile, null, 2), ''] : []

// 一个人和一条机会线是两种东西：线有阶段和截止推着，人只有「你们是什么关系」。
// 所以这一段分岔，往来那一段以下完全共用。
function ownerBlock({ p, profile, kind }) {
  if (kind === 'contact') {
    return [
      '## 这个人',
      fact('名字', p.name) + fact('机构', p.org) + fact('他管什么', p.role) +
      fact('邮箱', p.email) + fact('谁介绍的', p.intro_by_name) +
      fact('上次碰', p.last_touch_at && `${p.last_touch_at}（${
        { email: '来自那封信', checkin: '你打的卡', meet: '你记的一笔' }[p.last_touch_src] || '来源不明'}）`) +
      fact('说好什么时候再碰', p.next_touch_at && `${p.next_touch_at}${p.next_touch_why ? ` —— ${p.next_touch_why}` : ''}`) +
      fact('关系记忆', p.notes) +
      fact('他挂着的机会线', (p.pursuits || []).map((x) => x.title).join('、')),
      '',
      // 这条规矩只给「人」，机会线那条路没有——搬家时最容易掉的就是它，
      // 所以测试里 contact 那条单独走一遍。
      '写给他的信按对方语言写。**别写纯问候**——在美国，「just checking in」/「hope you\'re well」' +
      '是公认最没用的邮件。每一封都得带一个由头：有新作品 / 看到个东西想到他 / 要去他的城市 / 恭喜他那个展。',
      '',
    ]
  }
  return [
    '## 这条机会线',
    fact('标题', p.title) + fact('机构', p.org) + fact('地点', p.location) +
    fact('类型', p.kind) + fact('资助', p.funding) + fact('截止', p.deadline) +
    fact('官方页面', p.url) + fact('当前阶段', p.stage) +
    fact('为什么可能合适', p.why) + fact('备注', p.notes) +
    (p.eligible === false
      ? `⚠️ 资格搁置：目前身份${idOf(profile) ? `（${idOf(profile)}）` : ''}不满足这条线的要求，先别推进申请。\n`
      : ''),
  ]
}

// incoming 那句刚已经落库了，所以要从「之前的往来」里摘出去（exceptId），
// 否则它会在 prompt 里出现两次。
function historyBlock({ msgs, profile }, exceptId) {
  const history = msgs.filter((m) => m.id !== exceptId)
  if (!history.length) return ['（还没有往来，刚开始。）\n']
  const lines = ['## 你们之前的往来（从早到晚）']
  for (const m of history) {
    const who = m.role === 'artist' ? artistOf(profile) : m.role === 'producer' ? '你（Fairwind）' : m.role
    const tag = m.kind && m.kind !== 'message' ? `〔${m.kind}〕` : ''
    lines.push(`${who}${tag}：${m.content}`)
  }
  lines.push('')
  return lines
}

const askBlock = (incoming) => [
  '## Ta 刚说',
  incoming,
  '',
  '回应 ta。直接说话，不要写「好的，我来回应」这类前言，也不要复述上面的资料。',
]

// ── 对话（chat）────────────────────────────────────────────

/**
 * 三档分组。**这是唯一的真相**——下面 buildPrompt / buildSystem / buildUser
 * 全从它派生，所以「三档拼起来 = 整个 prompt」是结构上成立的，不是靠人记得。
 */
export function promptParts(ctx, incoming, exceptId) {
  return {
    fixed:   [...profileBlock(ctx.profile), ...entriesBlock(ctx.entries)],
    perLine: [...filesBlock(ctx.raw?.attachments), ...ownerBlock(ctx)],
    talk:    [...historyBlock(ctx, exceptId), ...askBlock(incoming)],
  }
}

/** 老路子拼出来的那一整根字符串。现在只有测试用它当尺子——它是「没丢字」的判据。 */
export function buildPrompt(ctx, incoming, exceptId) {
  const { fixed, perLine, talk } = promptParts(ctx, incoming, exceptId)
  return [...fixed, ...perLine, ...talk].join('\n')
}

/**
 * systemPrompt：[静态块, 分界标记, 动态块]。
 *
 * 静态块（人格 + 档案 + 信息库）永不变，拿的是跨会话的缓存作用域——
 * 你重启脑子、明天再来，它照样是缓存读。动态块是这条线自己的资料，
 * 一次会话内不变。分界标记是 SDK 认的那个字符串，不是我们编的。
 */
export function buildSystem(ctx) {
  const { fixed, perLine } = promptParts(ctx, '', null)
  return [
    [systemFor(ctx.profile), '', ...fixed].join('\n'),
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    perLine.join('\n'),
  ]
}

/** user message：只剩往来和你刚说的那句。 */
export function buildUser(ctx, incoming, exceptId) {
  return promptParts(ctx, incoming, exceptId).talk.join('\n')
}

// ── 讲懂（brief）────────────────────────────────────────────

const briefTask = (profile) => `## 你的任务：把这个机会「讲懂」
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
- opens_at 是**开始接受申请**的日子。已经开放了就填 null——已经开的门不用再报开门时间`

export function briefParts({ p, entries, profile }) {
  return {
    fixed: [...profileBlock(profile), ...entriesBlock(entries)],
    perLine: [
      '## 要讲懂的机会（卡上现有信息，可能不全或过时）',
      fact('标题', p.title) + fact('机构', p.org) + fact('地点', p.location) +
      fact('类型', p.kind) + fact('资助', p.funding) + fact('截止（未必准）', p.deadline) +
      fact('已有链接', p.url) + fact('来源', p.source) + fact('备注', p.notes),
      '',
    ],
    talk: [briefTask(profile)],
  }
}

/** 老路子。同样只留给测试当尺子。 */
export function buildBriefPrompt(ctx) {
  const { fixed, perLine, talk } = briefParts(ctx)
  return [...fixed, ...perLine, ...talk].join('\n')
}

export function buildBriefSystem(ctx) {
  const { fixed, perLine } = briefParts(ctx)
  return [
    [systemFor(ctx.profile), '', ...fixed].join('\n'),
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    perLine.join('\n'),
  ]
}

export function buildBriefUser(ctx) {
  return briefParts(ctx).talk.join('\n')
}
