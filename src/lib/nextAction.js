// 卡上的**日期**。只剩日期。
//
// 这儿原来还有个 actionLine()——「该干什么」那一行，三档优先级：
// Fairwind 提的下一步 > 快开放 > 该碰一下了。整个删了，理由分三层：
//
//   · `next_action` **已经没人写了**：写它的消化环节（读新信 → 作废过期
//     待办 → 提新的下一步）随 runRefresh 一起删掉了。留着就是一行永远
//     不会更新的字，比空着更坏。
//   · 「该碰一下了」是**系统替你判**「这事该动了」。新规矩里这类判断归你：
//     你觉得该动，自己点亮「待处理」那个标签。
//   · 「N 天起开放」是**事实**，所以它留下来了——但不再包装成「该干什么」，
//     而是跟截止并排，作为日期显示（openLine）。
//
// voidedAction / doneAction 一起走了：它们是 next_action 的附属物。
// 库里那几个字段和 RPC 都留着不动——以后要不要重做「Fairwind 提下一步」
// 是另一场讨论，删列会让那场讨论失去材料。
//
// 设计稿：docs/specs/2026-08-12-four-signals-design.md

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** 'YYYY-MM-DD' → 本地零点的 Date。空值返回 null。 */
const asDate = (s) => (s ? new Date(s + 'T00:00:00') : null)

/** 距今天几天：负数 = 已经过去。 */
export function daysFromToday(dateStr) {
  const d = asDate(dateStr)
  if (!d) return null
  return Math.round((d - startOfToday()) / 86400000)
}

/** 'YYYY-MM-DD' → '8月12日'。 */
export const MD = (dateStr) => {
  const d = asDate(dateStr)
  return d ? `${d.getMonth() + 1}月${d.getDate()}日` : ''
}

/**
 * 快到期的门槛。
 *
 * **这是现在唯一还留着的系统判断**，而且只服务一件事：顶栏那个「紧急」开关。
 * 卡上的截止仍然照常显示原文，urgent 只决定标不标红、进不进那个筛选。
 * 这个门槛该是多少、甚至该不该有，是下一场讨论。
 */
const SOON_DAYS = 14

/**
 * 截止那一行。原文永远显示（"spring 2027" 这种要保留），
 * 只有能算出日期、而且确实近了，才追加倒计时并标红。
 */
export function deadlineLine(p) {
  if (!p.deadline && !p.deadline_at) return null
  const text = p.deadline || MD(p.deadline_at)
  const n = daysFromToday(p.deadline_at)
  if (n === null || n > SOON_DAYS) return { text: `截止 ${text}`, urgent: false }
  if (n < 0) return { text: `截止 ${text} · 已过`, urgent: true, over: true }
  if (n === 0) return { text: `截止 ${text} · 今天`, urgent: true }
  return { text: `截止 ${text} · 还剩 ${n} 天`, urgent: true }
}

/**
 * 开放那一行。有开始日期就显示——**这是确定的信息，不替你判急不急**。
 * 已经开放了就不说了：那时候「开放」不是新闻。
 */
export function openLine(p) {
  const n = daysFromToday(p.opens_at)
  if (n === null || n <= 0) return null
  return { text: `${MD(p.opens_at)}起开放 · 还有 ${n} 天` }
}
