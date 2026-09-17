// 「一个字都没丢」的机器版本。
//
// 2026-08-15 把 prompt 切成三档（静态 systemPrompt / 动态 systemPrompt / user message），
// 这是**搬位置**，不是改内容。所以判据不是「看着差不多」，是：
//
//   三档首尾相接 === 老 buildPrompt 逐字产出的那一根字符串
//
// 尺子（下面 legacy* 那几个函数）是老实现的**逐字复刻**，故意不从 prompt.js import——
// import 过来的话，改坏了 entriesBlock 两边一起错，测试照样绿，尺子就白立了。
//
// 跑：node --test brain/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isImage, IMG_CAP } from './files.js'
import {
  buildPrompt, buildSystem, buildUser, promptParts,
  buildBriefPrompt, buildBriefSystem, buildBriefUser,
  systemFor, entriesBlock, SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  judgeSystemFor, JUDGE_RULE,
} from './prompt.js'

// ── 尺子：老实现的逐字复刻 ──────────────────────────────────

const legacyArtistOf = (profile) => profile?.name || '这位艺术家'
const legacyIdOf = (profile) => {
  const d = profile?.data || {}
  const loc = Array.isArray(d.location) ? d.location.join(' / ') : d.location
  return [d.visa, loc && `常住 ${loc}`].filter(Boolean).join('，')
}

function legacyEntryFacts(e) {
  const m = e.meta || {}
  const keep = (xs) => xs.filter((x) => x && x !== '（待补）')
  const period = keep([m.start, m.end]).join(' – ')
  switch (e.kind) {
    case 'education': return keep([m.school, m.year, m.location])
    case 'job':       return keep([m.org, period, m.location])
    case 'credit':    return keep([m.org, m.year, m.location])
    case 'statement': return keep([m.scope])
    default:          return []
  }
}

function legacyEntriesBlock(entries) {
  if (!entries.length) return []
  const lines = ['## Ta 的作品与履历（战绩信息库）']
  for (const e of entries) {
    const label = e.kind === 'credit' && e.meta?.type ? `credit · ${e.meta.type}` : e.kind
    const bits = [e.year, e.medium, e.concern, ...legacyEntryFacts(e)].filter(Boolean).join(' · ')
    const tags = e.tags?.length ? `〔标签：${e.tags.join(' / ')}〕` : ''
    lines.push(`- [${label}] ${e.title}${bits ? ` (${bits})` : ''}${e.body ? ` — ${e.body}` : ''}${tags}`)
    // 2026-08-21 盒子上膛：这是搬家之后唯一一次**改内容**，尺子跟着长——
    // 从这天起尺子量的是「chat / brief 两条路 + 三档拼接」仍然逐字一致。
    const box = Object.entries(e.box || {}).filter(([, v]) => v != null && String(v).trim() !== '')
    if (box.length) {
      lines.push('  盒子（私密外联层，是给你的作战情报，不是对外文案——写「为什么是我」、判断怎么开口时用）：')
      for (const [k, v] of box) lines.push(`  · ${k}：${v}`)
    }
  }
  lines.push('')
  return lines
}

function legacyFilesBlock(atts) {
  if (!atts?.length) return []
  const lines = ['## 这条线上的文件']
  let anyImage = false
  for (const a of atts) {
    const img = isImage(a.filename, a.mime)
    if (img) anyImage = true
    const size = a.bytes ? `${(a.bytes / 1024).toFixed(0)} KB` : ''
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

function legacyBuildPrompt({ p, msgs, entries, profile, kind, raw, state }, incoming, exceptId) {
  const fact = (k, v) => (v ? `${k}：${v}\n` : '')
  const lines = []

  if (profile) {
    lines.push('## 关于这位艺术家')
    lines.push(JSON.stringify(profile, null, 2))
    lines.push('')
  }

  lines.push(...legacyEntriesBlock(entries))
  lines.push(...legacyFilesBlock(raw?.attachments))

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
        ? `⚠️ 资格搁置：目前身份${legacyIdOf(profile) ? `（${legacyIdOf(profile)}）` : ''}不满足这条线的要求，先别推进申请。\n`
        : '')
    )
  }

  // 2026-09-04（0123）：提醒栏那一行进 perLine。尺子跟着长——这是搬家之后
  // 第二次改内容。fixture 里没有 state，量的是「没有」那句；有 state 的
  // 那句单独在下面测。
  lines.push('## 提醒栏现在这样说')
  lines.push(state ? `${state.state}：${state.what || ''}` : '（没有这条线的事 —— 不等什么、不欠什么）')
  lines.push('这是按规则算的。你有全卷宗；你觉得它不对，就按「拨提醒」那条规矩改它，不用顺着它说。')
  lines.push('')

  const history = msgs.filter((m) => m.id !== exceptId)
  if (history.length) {
    lines.push('## 你们之前的往来（从早到晚）')
    for (const m of history) {
      const who = m.role === 'artist' ? legacyArtistOf(profile) : m.role === 'producer' ? '你（Fairwind）' : m.role
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

function legacyBuildBriefPrompt({ p, entries, profile }) {
  const fact = (k, v) => (v ? `${k}：${v}\n` : '')
  const lines = []

  if (profile) {
    lines.push('## 关于这位艺术家')
    lines.push(JSON.stringify(profile, null, 2))
    lines.push('')
  }
  lines.push(...legacyEntriesBlock(entries))

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
4. 有没有国籍 / 居留 / 工作权限制——对照这位艺术家的身份（${legacyIdOf(profile) || '档案里没填，别猜；拿不准就说需要确认'}）。ta 能不能申？
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

// ── 料 ──────────────────────────────────────────────────────

const profile = {
  name: 'Hu Di',
  website: 'https://hudiworks.com/',
  data: { visa: 'O-1', location: ['Los Angeles', 'SF'], email: 'hudi@example.com' },
}

const entries = [
  { kind: 'work', title: 'Echo Chamber Realms', year: '2024', medium: '装置', concern: '算法与记忆', body: '一件长描述。', tags: ['互动', '声音'] },
  { kind: 'credit', title: '个展', meta: { type: '个展', org: 'CultureHub', year: '2025', location: 'NY' } },
  { kind: 'education', title: 'MFA', meta: { school: 'CalArts', year: '2021', location: 'LA' } },
  { kind: 'job', title: '讲师', meta: { org: 'UCLA', start: '2023', end: '2025', location: 'LA' } },
  { kind: 'statement', title: '创作自述', meta: { scope: '总述' }, body: '正文。' },
  { kind: 'offer', title: 'Paperbark — Workshop', year: '2026', medium: '工作坊', body: '一段英文描述。', tags: ['workshop'],
    box: { guardrail: '⚠️ 这个 workshop 还没真教过，对外只能说在谈。', video: 'https://youtu.be/xxxx', 空的: '' } },
]

const attachments = [
  { filename: '简历.pdf', mime: 'application/pdf', bytes: 204800, source: 'upload' },
  { filename: '现场.jpg', mime: 'image/jpeg', bytes: 1048576, source: 'mail' },
]

const msgs = [
  { id: 'm1', role: 'artist',   kind: 'message', content: '这个截止是几号？' },
  { id: 'm2', role: 'producer', kind: 'brief',   content: '官网写的是 3 月 15。' },
  { id: 'm3', role: 'org',      kind: 'email',   content: '来自机构的一封信。' },
  { id: 'm4', role: 'artist',   kind: 'message', content: '刚说的这句（应当被摘出去）' },
]

const pursuitCtx = {
  kind: 'pursuit',
  p: {
    title: 'UCSB · Media Arts', org: 'UCSB', location: 'Santa Barbara', kind: '教职',
    funding: '有', deadline: '2027-03-15', url: 'https://example.edu', stage: 'writing',
    why: '方向对得上', notes: '备注一句', eligible: false, source: '朋友推荐',
  },
  msgs, entries, profile,
  raw: { attachments },
}

const contactCtx = {
  kind: 'contact',
  p: {
    name: '张三', org: 'CultureHub', role: '策展', email: 'z@example.com',
    intro_by_name: '李四', last_touch_at: '2026-07-01', last_touch_src: 'email',
    next_touch_at: '2026-09-01', next_touch_why: '他说九月再聊',
    notes: '喜欢聊材料', pursuits: [{ title: '驻留 A' }, { title: '驻留 B' }],
  },
  msgs, entries, profile,
  raw: {},
}

const 空 = { kind: 'pursuit', p: { title: '光秃秃的一张卡' }, msgs: [], entries: [], profile: null, raw: {} }

// ── 一个字都没丢 ────────────────────────────────────────────

for (const [名字, ctx] of [['机会线', pursuitCtx], ['人', contactCtx], ['空卡', 空]]) {
  test(`${名字}：三档拼起来 === 老 buildPrompt，一个字不差`, () => {
    const { fixed, perLine, talk } = promptParts(ctx, '刚说的这句', 'm4')
    assert.equal(
      [...fixed, ...perLine, ...talk].join('\n'),
      legacyBuildPrompt(ctx, '刚说的这句', 'm4'),
    )
  })

  test(`${名字}：buildSystem + buildUser 合起来盖住老 prompt 的每一行`, () => {
    const 新 = [...buildSystem(ctx), buildUser(ctx, '刚说的这句', 'm4')].join('\n')
    for (const 行 of legacyBuildPrompt(ctx, '刚说的这句', 'm4').split('\n')) {
      if (!行.trim()) continue
      assert.ok(新.includes(行), `这一行搬丢了：${行.slice(0, 60)}`)
    }
  })
}

test('讲懂：三档拼起来 === 老 buildBriefPrompt', () => {
  assert.equal(buildBriefPrompt(pursuitCtx), legacyBuildBriefPrompt(pursuitCtx))
  const 新 = [...buildBriefSystem(pursuitCtx), buildBriefUser(pursuitCtx)].join('\n')
  for (const 行 of legacyBuildBriefPrompt(pursuitCtx).split('\n')) {
    if (!行.trim()) continue
    assert.ok(新.includes(行), `这一行搬丢了：${行.slice(0, 60)}`)
  }
})

test('人那条独有的「别写纯问候」没在搬家时掉', () => {
  const 新 = [...buildSystem(contactCtx), buildUser(contactCtx, 'x', null)].join('\n')
  assert.ok(新.includes('别写纯问候'))
  // 机会线那条本来就没有这句，搬完也不该冒出来
  const 线 = [...buildSystem(pursuitCtx), buildUser(pursuitCtx, 'x', null)].join('\n')
  assert.ok(!线.includes('别写纯问候'))
})

// ── 切得对不对（这才是省钱那件事的判据）────────────────────

test('静态块装的是永不变的那些：人格 + 档案 + 信息库', () => {
  const [静态] = buildSystem(pursuitCtx)
  assert.ok(静态.startsWith(systemFor(profile)))
  assert.ok(静态.includes('## 关于这位艺术家'))
  assert.ok(静态.includes('## Ta 的作品与履历（战绩信息库）'))
  assert.ok(静态.includes('Echo Chamber Realms'))
  // 会变的一律不许进来——进来一句，跨会话缓存就废了
  assert.ok(!静态.includes('## 你们之前的往来'))
  assert.ok(!静态.includes('## 这条机会线'))
  assert.ok(!静态.includes('## Ta 刚说'))
})

test('盒子跟着条目进了信息库——guardrail 这类外联情报 Fairwind 看得见', () => {
  const [静态] = buildSystem(pursuitCtx)
  assert.ok(静态.includes('还没真教过'), '盒子里的 guardrail 没进 prompt')
  assert.ok(静态.includes('https://youtu.be/xxxx'), '盒子里的链接没进 prompt')
  // 空值的 key 不该渲染出一行空的
  assert.ok(!静态.includes('空的'))
  // brief 那条路用同一个 entriesBlock，也得看得见
  assert.ok(buildBriefSystem(pursuitCtx)[0].includes('还没真教过'))
})

test('两条不同的线，静态块逐字相同（缓存能不能跨线命中就看这个）', () => {
  const a = buildSystem(pursuitCtx)[0]
  const b = buildSystem({ ...pursuitCtx, p: { title: '另一条完全不同的线' }, raw: {} })[0]
  assert.equal(a, b)
})

test('动态块装的是这条线自己的：文件清单 + 卡上字段', () => {
  const [, , 动态] = buildSystem(pursuitCtx)
  assert.ok(动态.includes('## 这条线上的文件'))
  assert.ok(动态.includes('简历.pdf'))
  assert.ok(动态.includes('## 这条机会线'))
  assert.ok(动态.includes('资格搁置'))
  assert.ok(!动态.includes('## 你们之前的往来'))
})

test('user message 只剩对话——信息库不在里面了（这次改动的全部意义）', () => {
  const u = buildUser(pursuitCtx, '刚说的这句', 'm4')
  assert.ok(u.includes('## 你们之前的往来'))
  assert.ok(u.includes('## Ta 刚说'))
  assert.ok(u.includes('刚说的这句'))
  assert.ok(!u.includes('## Ta 的作品与履历（战绩信息库）'))
  assert.ok(!u.includes('Echo Chamber Realms'))
  assert.ok(!u.includes('## 关于这位艺术家'))
  // 老的六万多字符里，信息库那两万多现在不在 user message 里了
  assert.ok(u.length < legacyBuildPrompt(pursuitCtx, '刚说的这句', 'm4').length / 2)
})

test('刚落库的那一句不会在往来里重复出现', () => {
  const u = buildUser(pursuitCtx, '刚说的这句', 'm4')
  assert.equal(u.split('刚说的这句').length - 1, 1)
})

// ── 语气是数据（2026-08-24）─────────────────────────────────
// 五个格子：agent_name / persona / letter_rule / form_rule / judge_rule。
// 安全性质只有一条：**格子空着 = 一个字都不变**。
// 下面这份「头 + 行为段」是切割前原文的逐字冻结——跟 legacy* 一个道理，
// 故意不从 prompt.js import：切割时手一抖改了字，这里会红。
// 见 docs/specs/2026-08-24-the-voice-is-data.md。

const 冻结的头和行为段 = `你是「 Fairwind 」，一位艺术家的 producer / 外联搭档。你服务的艺术家是 Hu Di，作品站 https://hudiworks.com/。

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

`

test('voice 空着 = 切割前逐字相同（头 + 行为段对冻结副本）', () => {
  for (const 空 of [undefined, null, {}, { persona: '', letter_rule: '   ', agent_name: '' }]) {
    const s = systemFor(profile, 空)
    assert.ok(s.startsWith(冻结的头和行为段), '头或行为段被切割改动了')
    // 两条规矩还挂在后面,顺序没变
    assert.ok(s.indexOf('[[LETTER]]') < s.indexOf('[[FORM]]'))
  }
  // 不传 voice 的老调用方式也一样
  assert.equal(systemFor(profile), systemFor(profile, {}))
})

test('填了哪格换哪格,其余照旧', () => {
  const s = systemFor(profile, { letter_rule: '## 写信\n就一行。' })
  assert.ok(s.includes('就一行。'))
  assert.ok(!s.includes('[[LETTER]]'))          // 默认那段整个被换掉
  assert.ok(s.includes('一次只递一件事'))        // persona 没动
  assert.ok(s.includes('[[FORM]]'))              // form_rule 没动
})

test('agent 名字随便起,Fairwind 只是默认', () => {
  const s = systemFor(profile, { agent_name: '小顺风' })
  assert.ok(s.startsWith('你是「 小顺风 」，一位艺术家的 producer / 外联搭档。'))
  assert.ok(!s.includes('Fairwind'))
})

test('换掉 persona,身份那句还在——它是档案数据,不是语气', () => {
  const s = systemFor(profile, { persona: '你只做一件事。' })
  assert.ok(s.includes('Hu Di'))
  assert.ok(s.includes('https://hudiworks.com/'))
  assert.ok(s.includes('你只做一件事。'))
  assert.ok(!s.includes('一次只递一件事'))
})

test('chat 和讲懂两条路都认 ctx.voice——分叉是最难查的那种坏', () => {
  const 有声 = { ...pursuitCtx, voice: { agent_name: '小顺风' } }
  assert.ok(buildSystem(有声)[0].startsWith('你是「 小顺风 」'))
  assert.ok(buildBriefSystem(有声)[0].startsWith('你是「 小顺风 」'))
  // 没 voice 的 ctx 照旧
  assert.ok(buildSystem(pursuitCtx)[0].startsWith('你是「 Fairwind 」'))
})

test('判断那段小人格能换,而且只有一份默认(原来 server/replay 抄了两份)', () => {
  assert.equal(judgeSystemFor(), JUDGE_RULE)
  assert.equal(judgeSystemFor({}), JUDGE_RULE)
  assert.equal(judgeSystemFor({ judge_rule: '  ' }), JUDGE_RULE)
  assert.equal(judgeSystemFor({ judge_rule: '只答是或否。' }), '只答是或否。')
  assert.ok(JUDGE_RULE.includes('很小的判断'))
})

test('分界标记用的是 SDK 认的那个，不是我们编的', () => {
  assert.equal(SYSTEM_PROMPT_DYNAMIC_BOUNDARY, '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__')
  assert.equal(buildSystem(pursuitCtx)[1], SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  assert.equal(buildSystem(pursuitCtx).length, 3)
})

test('往来里的 kind 标签和「谁说的」都还在', () => {
  const u = buildUser(pursuitCtx, 'x', null)
  assert.ok(u.includes('Hu Di：这个截止是几号？'))
  assert.ok(u.includes('你（Fairwind）〔brief〕：'))
  assert.ok(u.includes('org〔email〕：'))
})

test('没有往来时那句「还没有往来，刚开始」还在', () => {
  assert.ok(buildUser(空, '第一句', null).includes('（还没有往来，刚开始。）'))
})

// ── 信封 ───────────────────────────────────────────────────

test('写信的规矩在人格里——它得知道写完信要报一声', () => {
  const s = systemFor(profile)
  assert.ok(s.includes('[[LETTER]]'), '得给出标记名')
  assert.ok(s.includes('"to"') && s.includes('"subject"') && s.includes('"summary"'))
})

test('明说了「只在真写了一封信时才吐」——这是形式判断，不是「该不该发」', () => {
  const s = systemFor(profile)
  assert.ok(s.includes('真的写了一封'))
  assert.ok(s.includes('语气示范') || s.includes('讨论'), '得点出哪些情况不要吐')
})

test('信封的规矩在静态块里，跟着缓存走', () => {
  assert.ok(buildSystem(pursuitCtx)[0].includes('[[LETTER]]'))
})

// ── 表单 ───────────────────────────────────────────────────

test('填表的规矩在人格里，且给了标记名和逐格字数闸的写法', () => {
  const s = systemFor(profile)
  assert.ok(s.includes('[[FORM]]'), '得给出标记名')
  assert.ok(s.includes('"fields"') && s.includes('"q"') && s.includes('"a"'))
  assert.ok(s.includes('"words"') && s.includes('"chars"'), '逐格的字数闸得说清怎么写')
})

test('明说了字数限制要照抄机构原文，不许自己定一个', () => {
  const s = systemFor(profile)
  assert.ok(s.includes('别自己定') || s.includes('照抄') || s.includes('原文'))
})

test('两个标记互不干扰，都在静态块里', () => {
  const fixed = buildSystem(pursuitCtx)[0]
  assert.ok(fixed.includes('[[LETTER]]'))
  assert.ok(fixed.includes('[[FORM]]'))
})

// ── 提醒栏那一行（0123）──────────────────────────────────────

test('有 state 时 perLine 带着提醒栏那句，在动态块里，不在静态块里', () => {
  const ctx = { ...pursuitCtx, state: { state: 'WAITING_REPLY', what: '等 Joy 回信', due_at: '2026-09-11T07:00:00+00:00', zone: 'stopped', followups: 2 } }
  const { perLine, fixed } = promptParts(ctx, '刚说的这句', 'm4')
  const 动 = perLine.join('\n'), 静 = fixed.join('\n')
  assert.ok(动.includes('## 提醒栏现在这样说') && 动.includes('等 Joy 回信') && 动.includes('连发 3 封'), 动)
  assert.ok(!静.includes('提醒栏现在这样说'))
})

test('拨提醒的规矩在静态块里，七种 move 都点了名', () => {
  const sys = systemFor(profile)
  assert.ok(sys.includes('[[STATE]]'))
  assert.ok(sys.includes('[[MEMO]]'))
  for (const m of ['resolved', 'wait', 'reschedule', 'park', 'needs_reply', 'meeting', 'done'])
    assert.ok(sys.includes(`"${m}"`), m)
})

// ── 「在写」的条目（0127）─────────────────────────────────────
//
// 这个标只管一件事：**没写完的东西不许被当成战绩发出去**。所以外联这两条路
// （对话 / 讲懂）看不见它。书桌那边是另一回事——他正在那儿写它，见 studio.test.js。

test('在写的条目不进外联的信息库', () => {
  const es = [
    { kind: 'work', title: '写完的那件' },
    { kind: 'work', title: '还在写的那件', draft: true },
  ]
  const out = entriesBlock(es).join('\n')
  assert.ok(out.includes('写完的那件'))
  assert.ok(!out.includes('还在写的那件'))
})

test('全是在写的，整块不出现——不留一个空标题在那儿', () => {
  assert.deepEqual(entriesBlock([{ kind: 'work', title: 'x', draft: true }]), [])
})

test('反过来要得到在写的那几条：drafts:true', () => {
  const es = [
    { kind: 'offer', title: '写完的工作坊' },
    { kind: 'offer', title: '在写的 proposal', draft: true },
  ]
  const out = entriesBlock(es, { drafts: true, title: '## 他还在写的' }).join('\n')
  assert.ok(out.includes('## 他还在写的'))
  assert.ok(out.includes('在写的 proposal'))
  assert.ok(!out.includes('写完的工作坊'))
})

test('整条路走一遍：在写的既不进静态块，也不进讲懂', () => {
  const ctx = { ...pursuitCtx, entries: [...pursuitCtx.entries, { kind: 'work', title: '半成品XYZ', draft: true }] }
  assert.ok(!buildSystem(ctx)[0].includes('半成品XYZ'))
  assert.ok(!buildBriefSystem(ctx)[0].includes('半成品XYZ'))
})
