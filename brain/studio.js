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
//   perLine 空。书桌没有「每条线不同、一次会话内不变」的东西
//   talk    在写的那几条 + 往来 + 他在写哪个 + 他刚说的那句 → user message
//
// **静态块按栏切不得。** 切了就是七八个不同的开头，每一栏各自全价读一遍那两万字
// ——为了省而切，结果花得更多。而且全给对这件事是好处：他写工作坊 proposal 时，
// 它得能张口引用他那 22 个展览。
//
// **在写的那几条放 talk 不放 fixed。** 他正在改它们，每改一下 fixed 就变一次，
// 那两万字的缓存就废一次。它们本来就短，放在每轮都变的地方不花什么钱。

import { entriesBlock, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from './prompt.js'

export { SYSTEM_PROMPT_DYNAMIC_BOUNDARY }

export const STUDIO_SYSTEM = (profile) => {
  const name = profile?.name
  const site = profile?.website
  const who = name ? `你服务的艺术家是 ${name}${site ? `，作品站 ${site}` : ''}。` : ''
  return `你是「 Fairwind 」，一位艺术家的 producer / 外联搭档。${who}

现在你坐在**他档案里的一张书桌前**。这儿的活跟外联那摊不一样：
陪他把**他自己的东西**说准——改一件作品的描述、想清楚某件作品到底在讲什么、
一起搭一份课程或工作坊 proposal 的骨架、把一段自述改到像他说的话。

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
 * 「他现在在写哪个」。
 *
 * 焦点靠**他本来就在做的事**定：展开着哪几条，就是哪几条。没有新按钮、
 * 没有「选中」这个动作要他学。
 *
 * count 是这一栏一共几条，open 是展开着的 [{id, title}]。
 */
export function focusBlock(f) {
  if (!f?.label) return []
  const lines = ['## 他现在在写哪个', `他开着「${f.label}」这一栏，里面 ${f.count ?? 0} 条。`]
  if (f.open?.length) {
    lines.push('展开着这几条（他多半就在说它们）：')
    for (const e of f.open) lines.push(`- 《${e.title}》（id ${e.id}）`)
    lines.push('指其中哪一条时把标题说出来，他好对上。')
  }
  lines.push('')
  return lines
}

// 往来。incoming 那句刚已经落库了，所以要从历史里摘出去（exceptId），
// 否则它会在 prompt 里出现两次。
function historyBlock({ msgs, profile }, exceptId) {
  const history = (msgs || []).filter((m) => m.id !== exceptId && !m.deleted_at)
  if (!history.length) return ['（这张桌子上还没聊过，刚开始。）\n']
  const who = (m) => (m.role === 'artist' ? (profile?.name || '这位艺术家') : m.role === 'producer' ? '你（Fairwind）' : m.role)
  return ['## 你们在这张桌子上聊过的（从早到晚）', ...history.map((m) => `${who(m)}：${m.content}`), '']
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
  const entries = ctx.entries || []
  return {
    fixed: [...profileBlock(ctx.profile), ...entriesBlock(entries)],
    perLine: [],
    talk: [
      ...entriesBlock(entries, { drafts: true, title: DRAFTS_TITLE }),
      ...historyBlock(ctx, exceptId),
      ...focusBlock(ctx.focus),
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

/** user message：在写的那几条 + 往来 + 他在写哪个 + 他刚说的那句。 */
export function buildStudioUser(ctx, incoming, exceptId) {
  return studioParts(ctx, incoming, exceptId).talk.join('\n')
}
