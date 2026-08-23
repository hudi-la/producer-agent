// 「流水」那一页的日历格子 —— GitHub 那种一年铺成一片方格的排法。
//
// 为什么值得换掉原来那种一天一段往下排：流水回答的是「这阵子我到底动了没有」，
// 那是个**形状**问题，不是一条条读出来的。铺成方格，一眼看得见连着动的那几周、
// 断掉的那几天；原来那种排法你得滚三屏才知道上个月有没有停过。
//
// 这儿只算格子，不碰颜色也不碰 DOM：给一份「哪天有几件」，还一份周×7 的表。

const pad = (n) => String(n).padStart(2, '0')

/** 本地日子的键。**不用 toISOString** —— 那个按 UTC 切，东八区的凌晨会退到前一天。 */
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** 一天挪 n 天。用中午做基准，夏令时那两天才不会多退少补出一小时的差。 */
const shift = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)
  x.setDate(x.getDate() + n)
  return x
}

/** 周一开头（中国习惯）。getDay() 里周日是 0，先折回 7 再减。 */
const mondayOf = (d) => shift(d, -((d.getDay() || 7) - 1))

/**
 * 深浅分四档。门槛写死不按当期最大值缩放 —— 缩放的话「今天最多 3 件」
 * 会跟「今天最多 22 件」染出一样深的颜色，你两周后回头看会读错自己。
 */
export const STEPS = [3, 6, 11]
export function levelOf(n) {
  if (!n) return 0
  if (n < STEPS[0]) return 1
  if (n < STEPS[1]) return 2
  if (n < STEPS[2]) return 3
  return 4
}

/**
 * 铺格子。从 today 往回数 span 天，补齐到整周。
 *
 * 返回 weeks：每项是一列（七格，周一在上）。格子是 { day, n } 或 null——
 * null 是补齐用的空位（头一周开头、末一周结尾），不画也不占键盘焦点。
 */
export function weeksOf(counts, span, today = new Date()) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
  const first = shift(end, -(span - 1))
  const firstKey = dayKey(first)
  const endKey = dayKey(end)

  const weeks = []
  let cur = mondayOf(first)
  while (dayKey(cur) <= endKey) {
    const col = []
    for (let i = 0; i < 7; i++) {
      const d = shift(cur, i)
      const k = dayKey(d)
      col.push(k < firstKey || k > endKey ? null : { day: k, n: counts.get(k) || 0 })
    }
    weeks.push(col)
    cur = shift(cur, 7)
  }
  return weeks
}

/**
 * 每一列头上要不要写月份：这一列里出现了新的月份就写。
 * 返回一个跟 weeks 等长的数组，元素是「8月」或 null。
 */
export function monthMarks(weeks) {
  const out = []
  let last = null
  for (const col of weeks) {
    const first = col.find(Boolean)
    const m = first ? Number(first.day.slice(5, 7)) : null
    if (m && m !== last) { out.push(`${m}月`); last = m } else out.push(null)
  }
  return out
}
