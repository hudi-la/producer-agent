// 日期怎么显示。**全 app 只有这一份。**
//
// ══ 为什么需要它 ═══════════════════════════════════════════════
//
// 库的时区是 UTC。你 8/13 下午五点记的一笔，存进去是 2026-08-14 00:11 UTC，
// 页面直接把那个日期摆出来，于是卡上写着「你记的一笔 · 2026-08-14」——
// 而你明明是十三号写的。
//
// 差一天这种事最阴：它不报错、不崩、看着完全正常，只是每天傍晚之后
// 记的东西全部记到明天去。等你哪天照着这些日期回想「我什么时候跟他聊的」，
// 得到的是一份系统性偏移的记忆。
//
// ══ 按谁的时区 ═════════════════════════════════════════════════
//
// 按**你住的地方**，不是按服务器。档案里 location 写着 Los Angeles，
// 所以默认洛杉矶。哪天你搬了，改 profile.data.tz 一处，全 app 跟着走。
//
// 不做的事：不按浏览器时区。你出差到纽约那三天，不该让所有历史日期
// 集体往前跳一格——「那封信是几号来的」是一个事实，不该跟着你的行程变。

const FALLBACK = 'America/Los_Angeles'
let TZ = FALLBACK

/** app 起来时调一次（App.jsx 读到档案之后）。 */
export function setTz(tz) {
  TZ = tz || FALLBACK
}
export const currentTz = () => TZ

/** Intl 的 formatToParts 拆出年月日，避开 toLocaleDateString 各平台格式不一致。 */
function partsOf(x) {
  const d = x instanceof Date ? x : new Date(x)
  if (Number.isNaN(+d)) return null
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  return { y: p.year, m: p.month, d: p.day }
}

/**
 * 时间戳 → '8/6'。两位数的月日都要去前导零，不能出现「8/06」。
 *
 * 传纯日期字符串（'2026-08-06'，库里 date 列那种）时**原样按它自己算**——
 * 那种值没有时刻，硬塞进时区换算会平白挪一天。
 */
export function md(x) {
  if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) {
    const [, m, d] = x.split('-')
    return `${Number(m)}/${Number(d)}`
  }
  const p = partsOf(x)
  return p ? `${Number(p.m)}/${Number(p.d)}` : '?'
}

/** 时间戳 → '2026-08-13'（当地）。存键、比日期都用它。 */
export function day(x) {
  if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) return x
  const p = partsOf(x)
  return p ? `${p.y}-${p.m}-${p.d}` : null
}

/** 当地的今天，'2026-08-13'。 */
export const today = () => day(new Date())
