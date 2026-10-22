// 档案里那张书桌的 prompt。**只有纯函数**——不碰库、不碰网、不起服务，所以测得了。
//
// 跟 prompt.js 是同一个 Fairwind，换一张桌子：那边的活是外联（找机会、写申请、
// 跟进），这边的活是陪他把**他自己的东西**说准。分成两个文件而不是在 systemFor()
// 里加个 if，是因为两边该有的规矩几乎不重叠——写信、填表、拨状态那三条
// 这边一条都不要，而这边「你改不了他的档案」那条那边也用不上。
//
// ── 最要紧的一条：它写不了库 ─────────────────────────────────
//
// 这张桌子上，Fairwind 手里一台写库的工具都没有（server.js 那边不给挂）。
// 人格里那句「你不动他的档案」不是在劝它，是在**告诉它事实**——不说的话它会
// 以为自己改了，然后对他说「我帮你改好了」，而他会信。这句假话比不写更坏。
//
// ── 三档切在哪儿 ────────────────────────────────────────────
//
// 照 prompt.js 那套（缓存是前缀匹配，见那边开头的长注释）：
//
//   fixed   人格 + 档案 + 写完的那些条目（19,486 字符）→ 静态块，跨会话缓存
//   perLine 空。一条一个对话，没有「一次会话内不变但各条不同」的东西
//   talk    在写的那几条 + **正在改的这一条** + 往来 + 他刚说的那句 → user message
//
// **静态块按条目切不得。** 切了就是几十个不同的开头，每一条各自全价读一遍
// 那两万字——为了省而切，结果花得更多。而且全给对这件事是好处：
// 他写工作坊 proposal 时，它得能张口引用他那 22 个展览。
//
// **在写的那几条、和正在改的这一条，放 talk 不放 fixed。** 他正在改它们，
// 每改一下 fixed 就变一次，那两万字的缓存就废一次。它们本来就短，
// 放在每轮都变的地方不花什么钱。

import { entriesBlock, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from './prompt.js'

export { SYSTEM_PROMPT_DYNAMIC_BOUNDARY }

export const STUDIO_SYSTEM = (profile) => {
  const name = profile?.name
  const site = profile?.website
  const who = name ? `你服务的艺术家是 ${name}${site ? `，作品站 ${site}` : ''}。` : ''
  return `你是「 Fairwind 」，一位艺术家的 producer / 外联搭档。${who}

现在你坐在**他档案里的一张书桌前**，桌上摊着**一条具体的东西**——
下面「他正在改这一条」那一段就是。这儿的活跟外联那摊不一样：
陪他把这一条说准——改描述、想清楚这件作品到底在讲什么、
搭一份课程或工作坊 proposal 的骨架、把一段自述改到像他说的话。

**你们这次就说这一条。** 别的条目在下面的信息库里，是弹药（引得出他的展览、
别的作品），不是这次要改的东西。

## 你不动他的档案

你手里一台写库的工具都没有。你写的每一个字都是**给他看的稿子**——
进不进档案、怎么进，是他自己复制过去、在那一格里自己改的。

所以：**别说「我帮你改好了」「我已经更新了」**。你没有，也做不到。
要说就说「这一版你看看」。

## 怎么写

- **出稿就出完整能用的整段。** 他要的是能直接拿走的字，不是「建议你在这里
  强调一下材料」。给整段，让他能选中、复制、粘过去。
- 改一条现有的东西时，**先说你改动了哪儿、为什么**，再给整段。一两句话就够，
  别写成批改作业。
- **别替他找腔调。** 他的话已经在档案里了——下面那几十条都是他写的。
  往那个方向靠，不是往「艺术家陈述该有的样子」靠。你不是在教他写申请文书。
- 拿不准他这件作品到底在讲什么，**问他**，别自己编一个说法然后往下写。
  编出来的那句他多半不会察觉，因为它听着挺像那么回事。
- **一次一件。** 别一口气给三个方向让他挑。挑最该现在想的那一件，把它写透。

## 查东西

要参考别人怎么写、某个机构的口味、某个词在这行里的用法，用 WebSearch / WebFetch
去查，别猜。

但**查回来的东西要说清是从哪儿来的**（哪个网站、谁写的）。
别把别人网页上的话直接当成他的话写出来——他要的是把自己的东西说准，
不是写得像别人。

## 看他的作品

有些条目下面挂着图。要判断画里的东西（这件作品长什么样、那个装置是什么尺度）
才开 open_work_image，别一上来全开一遍：一段文字开完就沉进历史，
**一张图进来就一直占着上下文、后面每一轮都重付一次**。`
}

// ── 一段一段的料 ────────────────────────────────────────────
// 跟 prompt.js 一样，每段返回**行数组**不返回拼好的字符串——这样「三档
// 首尾相接 = 整根 prompt」是能逐行比对的，不是靠人记得。

const profileBlock = (profile) =>
  profile ? ['## 关于这位艺术家', JSON.stringify(profile, null, 2), ''] : []

/**
 * 「他正在改这一条」。
 *
 * 这一段是整个 prompt 里最要紧的一块：对话挂在哪一条，桌上就摊着哪一条。
 * 全文原样摊开——信息库里那一行已经带着 body 了，但那是一长串里的一行，
 * 这儿要它**看着这一条说话**。
 *
 * 盒子也摊开：那是他补的私密外联层（为什么是现在、想触达谁、隐线、验证过的
 * 打法），改描述时正是该用的料。
 */
export function entryBlock(e) {
  if (!e?.id) return []
  const lines = [
    '## 他正在改这一条',
    `《${e.title || '（未命名）'}》（id ${e.id}，类型 ${e.kind}${e.draft ? '，他标着「还在写」' : ''}）`,
  ]
  const bits = [e.year, e.medium, e.concern].filter(Boolean).join(' · ')
  if (bits) lines.push(bits)
  const m = e.meta || {}
  const facts = Object.entries(m).filter(([, v]) => v != null && String(v).trim() !== '')
  if (facts.length) lines.push('字段：' + facts.map(([k, v]) => `${k}=${v}`).join('，'))
  lines.push('', '现在的描述：')
  lines.push(e.body ? e.body : '（空的——还没写。）')
  const box = Object.entries(e.box || {}).filter(([, v]) => v != null && String(v).trim() !== '')
  if (box.length) {
    lines.push('', '盒子（他补的私密层，是给你的料，不是对外文案）：')
    for (const [k, v] of box) lines.push(`· ${k}：${v}`)
  }
  if (e.images?.length) {
    lines.push('', `这条挂着 ${e.images.length} 张图。要判断画面里的东西才开 open_work_image。`)
  }
  lines.push('')
  return lines
}

/**
 * 往来。
 *
 * incoming 那句刚已经落库了，所以要从历史里摘出去（exceptId），否则它会在
 * prompt 里出现两次。
 *
 * **只读最后一道线以下的**（0128）：他按过「重开一轮」，线以上的那些话
 * 界面上照常摆着（往上滚就看得见），但你不该再背着它们想 —— 他按那一下
 * 要的就是这个。线本身也不进 prompt：它不是谁说的话。
 */
function historyBlock({ msgs, profile }, exceptId) {
  const all = (msgs || []).filter((m) => !m.deleted_at)
  const cut = all.map((m) => m.kind).lastIndexOf('restart')
  const history = all.slice(cut + 1).filter((m) => m.id !== exceptId && m.kind !== 'restart')
  if (!history.length) {
    return [cut >= 0
      ? '（他刚按了「重开一轮」—— 上面那些话你不用管了，从这儿重新开始。）\n'
      : '（这一条还没聊过，刚开始。）\n']
  }
  const who = (m) => (m.role === 'artist' ? (profile?.name || '这位艺术家') : m.role === 'producer' ? '你（Fairwind）' : m.role)
  return ['## 你们为这一条聊过的（从早到晚）', ...history.map((m) => `${who(m)}：${m.content}`), '']
}

const askBlock = (incoming) => [
  '## 他刚说',
  incoming,
  '',
  '回应他。直接说话，不要写「好的，我来帮你」这类前言，也不要复述上面的资料。',
]

const DRAFTS_TITLE =
  '## 他还在写的（标着「在写」，只有这张桌子上看得见 —— 外面写申请时翻不到）'

/**
 * 三档分组。**这是唯一的真相**——下面 buildStudioSystem / buildStudioUser
 * 都从它派生，所以「三档拼起来 = 整个 prompt」是结构上成立的。
 */
export function studioParts(ctx, incoming, exceptId) {
  // **信息库一条不筛。** 差点在这儿栽一跤：本想把「正在改的这一条」从信息库
  // 里摘掉免得重复，但那样每一条条目就各有一个不同的静态块开头 —— 缓存是
  // 前缀匹配，等于每开一条都全价重读那两万字。重复一行的代价远小于这个。
  const entries = ctx.entries || []
  return {
    fixed: [...profileBlock(ctx.profile), ...entriesBlock(entries)],
    perLine: [],
    talk: [
      ...entriesBlock(entries, { drafts: true, title: DRAFTS_TITLE }),
      ...entryBlock(ctx.entry),
      ...historyBlock(ctx, exceptId),
      ...askBlock(incoming),
    ],
  }
}

/** systemPrompt：[静态块, 分界标记, 空的动态块]。 */
export function buildStudioSystem(ctx) {
  const { fixed, perLine } = studioParts(ctx, '', null)
  return [
    [STUDIO_SYSTEM(ctx.profile), '', ...fixed].join('\n'),
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    perLine.join('\n'),
  ]
}

/** user message：在写的那几条 + 正在改的这一条 + 往来 + 他刚说的那句。 */
export function buildStudioUser(ctx, incoming, exceptId) {
  return studioParts(ctx, incoming, exceptId).talk.join('\n')
}
