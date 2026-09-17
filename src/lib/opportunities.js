import { supa, DB_CONFIGURED, FELL_BACK } from './backends.js'

// 机会池 = 他那张 Excel 搬进库之后的样子。
//
// 一行 = 世上有这么个机会。**不是卡** —— 卡背后拖着状态机、收信、通知、已读那一整套，
// 几百行进看板会把界面撑爆，而这些行根本没有往来可判。捡出来才变成卡。
//
// 这个文件只管「怎么说、怎么排、怎么筛」和两个写口。表长什么样在 components/Opportunities.jsx。
//
// 设计稿：docs/specs/2026-09-03-opportunity-pool-design.md

// ── 说人话 ────────────────────────────────────────────────────

/** 上次查的时候开着没有。 */
export const STATUS_LABEL = { open: '开着', closed: '关着', unknown: '没查过' }

/**
 * 够不够得着。**unknown 不是「差」，是「往届名单没查到」** ——
 * 这两件事在界面上必须分得开，不然他会把「没查到」当成「不行」。
 */
export const REACH_LABEL = {
  realistic: '够得着',
  stretch: '有点悬',
  longshot: '多半白投',
  unknown: '没查到',
}

const RANK = { realistic: 0, unknown: 1, stretch: 2, longshot: 3 }

/** 这一行现在算什么。排序和筛选都问它，问两处迟早会分叉。 */
export function laneOf(o) {
  if (o.dropped_at) return 'dropped'
  if (o.pursuit_id) return 'onboard'
  if (o.status === 'open') return 'open'
  return 'watching'
}

export const LANES = [
  ['open', '开着的'],
  ['watching', '关注中'],
  ['onboard', '已在看板上'],
  ['dropped', '别再提了'],
]

/** 日期说成「9/7」；没有就空。 */
export const shortDate = (d) => {
  if (!d) return ''
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${Number(m[2])}/${Number(m[3])}` : ''
}

/** 截止那一格：能算出日子的说日子，算不出的原样显示原话（截短）。 */
export function whenText(o) {
  if (o.status === 'open') {
    if (o.deadline_at) return `截止 ${shortDate(o.deadline_at)}`
    return o.deadline ? String(o.deadline).slice(0, 22) : '没记截止'
  }
  if (o.opens_at) return `约 ${shortDate(o.opens_at)} 开`
  if (o.deadline_at) return `上轮 ${shortDate(o.deadline_at)}`
  return o.deadline ? String(o.deadline).slice(0, 22) : ''
}

/**
 * 标着「开着」但截止日已经过了 —— 那是**旧状态没复查过**，不是真的开着。
 * 从 Excel 搬进来的 28 行里有一大半是这样（🟢 是几个月前的记录）。
 * 不标出来的话，界面就在替它撒谎：绿点 + 「截止 6/1」，而今天是 9 月。
 * 复查那一步的优先级里专门有这一档（pa_opp_to_check 的 pri=1）。
 */
export function staleOpen(o, today = new Date().toISOString().slice(0, 10)) {
  return o?.status === 'open' && Boolean(o.deadline_at) && String(o.deadline_at) < today
}

/** 上次查是什么时候。**从来没查过要说出来**，空着会被当成「查过没事」。 */
export const checkedText = (o) => (o.checked_at ? `${shortDate(o.checked_at)} 查过` : '没查过')

// ── 排序 ──────────────────────────────────────────────────────

/**
 * 开着且还没捡的排最前，然后星多的、够得着的、截止近的。
 * 已在看板上的和别再提了的沉底 —— **但不消失**：消失了他会以为丢了。
 */
const LANE_ORDER = { open: 0, watching: 1, onboard: 2, dropped: 3 }

export function sortPool(rows = []) {
  return [...rows].sort((a, b) =>
    LANE_ORDER[laneOf(a)] - LANE_ORDER[laneOf(b)]
    || (b.fit_stars || 0) - (a.fit_stars || 0)
    || (RANK[a.reach || 'unknown'] ?? 1) - (RANK[b.reach || 'unknown'] ?? 1)
    || String(a.deadline_at || '9999-99-99').localeCompare(String(b.deadline_at || '9999-99-99'))
    || String(a.title).localeCompare(String(b.title)))
}

/** 最近那一轮是哪天。「本轮还找到这些」就是拿它筛。 */
export function latestRound(rows = []) {
  let best = null
  for (const o of rows) if (o.noted_round && (!best || o.noted_round > best)) best = o.noted_round
  return best
}

/** 每一格里有几行 —— 筛选条上的数字。 */
export function counts(rows = []) {
  const out = { all: rows.length, open: 0, watching: 0, onboard: 0, dropped: 0 }
  for (const o of rows) out[laneOf(o)]++
  return out
}

// ── 读 ────────────────────────────────────────────────────────

const seed = (reason, detail) => ({ rows: [], source: 'seed', reason, detail })

export async function loadPool() {
  if (!DB_CONFIGURED) return seed(FELL_BACK.NO_CONFIG)
  try {
    // 一次最多 1000 行是 PostgREST 的默认封顶，而且它不报错。池子真长到那个数
    // 得改成分页 —— 现在 82 行，先把上限写出来，别让它变成静默截断。
    const { data, error } = await supa
      .from('v_pa_opportunities').select('*').limit(1000)
    if (error) return seed(FELL_BACK.QUERY_FAILED, error.message)
    return { rows: data || [], source: 'live', reason: null }
  } catch (e) {
    return seed(FELL_BACK.QUERY_FAILED, e.message)
  }
}

// ── 写：两个都是「你的动作」 ──────────────────────────────────

/** 捡出来：池子里一行变成看板上一张卡。幂等，已经捡过就返回原来那张。 */
export async function pickOpportunity(id) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { data, error } = await supa.rpc('pa_pick_opportunity', { p_id: id })
  if (error) throw new Error(error.message)
  return data
}

/** 别再提：不再复查、不再推。**不删行**——删了就没法回答「这个我当初为什么划掉」。 */
export async function dropOpportunity(id, why = null) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { error } = await supa.rpc('pa_drop_opportunity', { p_id: id, p_why: why })
  if (error) throw new Error(error.message)
}

/** 划错了能划回来。没有撤销的破坏性动作，用着用着就没人敢按了。 */
export async function undropOpportunity(id) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { error } = await supa.rpc('pa_undrop_opportunity', { p_id: id })
  if (error) throw new Error(error.message)
}
