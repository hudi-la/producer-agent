// 战绩信息库的**结构**：有哪几类条目、怎么分组、折叠行上显示哪一条事实。
// 这里是骨架 —— 不含任何一个艺术家的内容。某个艺术家的示范内容在 src/demo/。
//
// 拆分之前这些跟 57 条胡地的作品/履历同住一个文件（旧 src/data/entriesSeed.js），
// 见 docs/specs/2026-08-13-skeleton-and-flesh-design.md。


// credit 子分组的类型顺序 + 标签（作品按 concern 子分组，见 CONCERNS_SEED）
export const CREDIT_ORDER = ['个展', '群展', '驻地', 'grant', '策展']
export const CREDIT_LABEL = { 个展: '个展', 群展: '群展 / 演出', 驻地: '驻地', grant: '资助 / 奖学金', 策展: '策展项目' }

// Section order + labels. `sub` sub-groups a section: 'concern'(作品) | 'credit'(按 meta.type)。
export const KINDS = [
  { key: 'work', label: '作品', sub: 'concern' },
  { key: 'statement', label: '自述 · Bio' },
  { key: 'job', label: '工作 · 职业经历' },
  { key: 'education', label: '教育 · 背景' },
  { key: 'credit', label: '展览 · 驻地 · 获奖 · 策展', sub: 'credit' },
  { key: 'skill', label: '技能' },
  // 库里一直有 offer（可提供的工作坊/服务），但这张表里没有它 —— 于是它在档案页上
  // 顶着一个直接叫 "offer" 的标题（走 Library 里那条「不认识的 kind」兜底）。
  // 档案页改成左右两栏之后它会变成左栏一行 "offer"，更刺眼，所以补上。
  { key: 'offer', label: '工作坊 · 可提供' },
]

// 左栏一行 = 一「格」。格**不等于** kind：credit 那 30 条挤在一格里，右边还是要滚很久，
// 所以按类型拆成三格。类型落在这三格之外的（以后新加的 type）不会消失——
// Library 会把它们兜进一格「其他战绩」。
export const CREDIT_GROUPS = [
  { key: 'exhibition', label: '展览', types: ['个展', '群展'] },
  { key: 'residency', label: '驻地 · 资助', types: ['驻地', 'grant'] },
  { key: 'curatorial', label: '策展', types: ['策展'] },
]

// Kind-specific one-line facts shown on the collapsed row (from meta).
export function subInfo(entry) {
  const m = entry.meta || {}
  const clean = (xs) => xs.filter((x) => x && x !== '（待补）')
  const join = (...xs) => clean(xs).join(' · ')
  const period = clean([m.start, m.end]).join(' – ')
  switch (entry.kind) {
    case 'work': return clean([entry.medium])
    case 'job': return clean([m.org, period, m.location])
    case 'education': return clean([m.school, m.year, m.location])
    case 'credit': return clean([m.org, m.year, m.location]) // type 已是子分组标题，不重复
    case 'statement': return clean([{ artist: 'Artist Statement', 'bio-short': '一句话', 'bio-long': '长 Bio', research: '读博方向' }[m.scope] || m.scope])
    default: return []
  }
}

// 折叠行上那几条事实，哪些能在页面上改 —— 以及它们各自住在库里哪儿。
//
// 紧挨着 subInfo 放，因为它俩说的是同一件事的两面：显示什么、就能改什么。
// 拆到两个文件去的话，以后加一个 kind 必然只改一边 —— 而那种漏法不报错，
// 只会让某一类条目悄悄变成只读。src/lib/entries.test.js 里有一条测试盯着这个。
//
// col: true  = producer.works 表上的一列（medium）
// 不写       = 住在 meta 那个 jsonb 里（org / school / year / location…）
// 这个区别没道理可讲，是历史。所以只让它活在这一张表里。
export const EDITABLE = {
  work: [{ key: 'medium', label: '媒介', col: true }],
  job: [
    { key: 'org', label: '机构' },
    { key: 'start', label: '开始' },
    { key: 'end', label: '结束' },
    { key: 'location', label: '地点' },
  ],
  education: [
    { key: 'school', label: '学校' },
    { key: 'year', label: '年份' },
    { key: 'location', label: '地点' },
  ],
  credit: [
    { key: 'org', label: '机构' },
    { key: 'year', label: '年份' },
    { key: 'location', label: '地点' },
  ],
  statement: [{ key: 'scope', label: '类型', hint: 'artist / bio-short / bio-long / research' }],
}

// ── 造卡任务的类型说明（producer.tasks.type → 一句人话）────────────────
// 这些描述的是**系统支持哪几类造卡任务**，不是某个人的任务清单。
// 清单（哪几条开着、上次跑出什么）是内容，在 src/demo/tasks.js。
export const TASK_DESC = {
  scout_aggregators: '扫 Creative Capital / Colossal / TransArtists…按你的画像筛、查资格、去重',
  scout_search: '按提示词里那几组关键词联网搜新冒出来的 open call / 驻地 / grant，按画像筛、去重',
  agency_scout: '扫模特/演艺经纪的 commercial / lifestyle / beauty 板，逐家核实投递入口再造卡',
  manual: '朋友转的、你刷到的——贴链接 / 截图 / 一句话，我写成卡',
  institution_monitor: '专盯某机构，它开下一轮 open call 就造张卡',
  email_watch: '进你信箱的邀约 / open call → 自动造卡',
  relationship_followup: '某联系人久没动静 → 造张"该 nudge 了"的卡',
}
