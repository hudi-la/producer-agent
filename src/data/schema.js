// 战绩信息库的**结构**：有哪几类条目、怎么分组、折叠行上显示哪一条事实。
// 这里是骨架 —— 不含任何一个艺术家的内容。某个艺术家的示范内容在 src/demo/。
//
// 拆分之前这些跟 57 条胡地的作品/履历同住一个文件（旧 src/data/entriesSeed.js），
// 见 docs/specs/2026-08-13-skeleton-and-flesh-design.md。
import { t } from '../i18n/index.js'

// credit 子分组的类型顺序 + 标签（作品按 concern 子分组，见 CONCERNS_SEED）
export const CREDIT_ORDER = ['个展', '群展', '驻地', 'grant', '策展']  // i18n-ok: 类型值跟库里 meta.type 对得上，不是显示文字
export const CREDIT_LABEL = { 个展: '个展', 群展: '群展 / 演出', 驻地: '驻地', grant: '资助 / 奖学金', 策展: '策展项目' }  // i18n-ok: 键是库值；标签在 Library.jsx 里过 t()

// Section order + labels. `sub` sub-groups a section: 'concern'(作品) | 'credit'(按 meta.type)。
export const KINDS = [
  { key: 'work', label: '作品', sub: 'concern' },  // i18n-ok: label 在 Library.jsx 里过 t()
  { key: 'statement', label: '自述 · Bio' },  // i18n-ok: label 在 Library.jsx 里过 t()
  { key: 'job', label: '工作 · 职业经历' },  // i18n-ok: label 在 Library.jsx 里过 t()
  { key: 'education', label: '教育 · 背景' },  // i18n-ok: label 在 Library.jsx 里过 t()
  { key: 'credit', label: '展览 · 驻地 · 获奖 · 策展', sub: 'credit' },  // i18n-ok: label 在 Library.jsx 里过 t()
  { key: 'skill', label: '技能' },  // i18n-ok: label 在 Library.jsx 里过 t()
  // 库里一直有 offer（可提供的工作坊/服务），但这张表里没有它 —— 于是它在档案页上
  // 顶着一个直接叫 "offer" 的标题（走 Library 里那条「不认识的 kind」兜底）。
  // 档案页改成左右两栏之后它会变成左栏一行 "offer"，更刺眼，所以补上。
  { key: 'offer', label: '工作坊 · 可提供' },  // i18n-ok: label 在 Library.jsx 里过 t()
]

// 左栏一行 = 一「格」。格**不等于** kind：credit 那 30 条挤在一格里，右边还是要滚很久，
// 所以按类型拆成三格。类型落在这三格之外的（以后新加的 type）不会消失——
// Library 会把它们兜进一格「其他战绩」。
export const CREDIT_GROUPS = [
  { key: 'exhibition', label: '展览', types: ['个展', '群展'] },  // i18n-ok: label 在 Library.jsx 里过 t()；types 是库值
  { key: 'residency', label: '驻地 · 资助', types: ['驻地', 'grant'] },  // i18n-ok: label 在 Library.jsx 里过 t()；types 是库值
  { key: 'curatorial', label: '策展', types: ['策展'] },  // i18n-ok: label 在 Library.jsx 里过 t()；types 是库值
]

// Kind-specific one-line facts shown on the collapsed row (from meta).
export function subInfo(entry) {
  const m = entry.meta || {}
  const clean = (xs) => xs.filter((x) => x && x !== '（待补）')  // i18n-ok: 库里存的占位值，拿来比对
  const join = (...xs) => clean(xs).join(' · ')
  const period = clean([m.start, m.end]).join(' – ')
  switch (entry.kind) {
    case 'work': return clean([entry.medium])
    case 'job': return clean([m.org, period, m.location])
    case 'education': return clean([m.school, m.year, m.location])
    case 'credit': return clean([m.org, m.year, m.location]) // type 已是子分组标题，不重复
    case 'statement': return clean([{ artist: 'Artist Statement', 'bio-short': t('一句话'), 'bio-long': t('长 Bio'), research: t('读博方向') }[m.scope] || m.scope])
    // 自定义类目:meta 里前三个键的值当副标题——结构是各人自己的,这儿不猜键名
    default: return clean(Object.values(m).filter((v) => typeof v === 'string').slice(0, 3))
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
  work: [{ key: 'medium', label: '媒介', col: true }],  // i18n-ok: label 在 Library.jsx 里过 t()
  job: [
    { key: 'org', label: '机构' },  // i18n-ok: label 在 Library.jsx 里过 t()
    { key: 'start', label: '开始' },  // i18n-ok: label 在 Library.jsx 里过 t()
    { key: 'end', label: '结束' },  // i18n-ok: label 在 Library.jsx 里过 t()
    { key: 'location', label: '地点' },  // i18n-ok: label 在 Library.jsx 里过 t()
  ],
  education: [
    { key: 'school', label: '学校' },  // i18n-ok: label 在 Library.jsx 里过 t()
    { key: 'year', label: '年份' },  // i18n-ok: label 在 Library.jsx 里过 t()
    { key: 'location', label: '地点' },  // i18n-ok: label 在 Library.jsx 里过 t()
  ],
  credit: [
    { key: 'org', label: '机构' },  // i18n-ok: label 在 Library.jsx 里过 t()
    { key: 'year', label: '年份' },  // i18n-ok: label 在 Library.jsx 里过 t()
    { key: 'location', label: '地点' },  // i18n-ok: label 在 Library.jsx 里过 t()
  ],
  statement: [{ key: 'scope', label: '类型', hint: 'artist / bio-short / bio-long / research' }],  // i18n-ok: label 在 Library.jsx 里过 t()
}

// ── 造卡任务的类型说明（producer.tasks.type → 一句人话）────────────────
// 这些描述的是**系统支持哪几类造卡任务**，不是某个人的任务清单。
// 清单（哪几条开着、上次跑出什么）是内容，在 src/demo/tasks.js。
// 用 getter：t() 要在渲染时才调（模块加载时语言还没定）。
export const TASK_DESC = {
  get scout_aggregators() { return t('每周三步：先查关注表里那些开了没有，再扫聚合源和搜索找新的，最后把够得着的造成卡') },
  get agency_scout() { return t('扫模特/演艺经纪的 commercial / lifestyle / beauty 板，逐家核实投递入口再造卡') },
  get manual() { return t('朋友转的、你刷到的——贴链接 / 截图 / 一句话，我写成卡') },
  get institution_monitor() { return t('专盯某机构，它开下一轮 open call 就造张卡') },
  get email_watch() { return t('进你信箱的邀约 / open call → 自动造卡') },
  get relationship_followup() { return t('某联系人久没动静 → 造张"该 nudge 了"的卡') },
}
