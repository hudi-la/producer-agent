import { supa } from './backends.js'
import { t } from '../i18n/index.js'

// 造卡任务：排期怎么说成人话，以及面板上那两个写口。
//
// 排期存在库里三列（run_every / run_weekday / run_hour，见 0119），
// 面板上显示成「每周一 08:00 · 下次 9/7」。老那列 schedule（'weekly' / '手动'）
// 只当兼容读法：没填新三列的老任务，照旧显示「每周」。

export const WEEKDAYS = [t('周日'), t('周一'), t('周二'), t('周三'), t('周四'), t('周五'), t('周六')]
export const HOURS = Array.from({ length: 24 }, (_, h) => h)

const hh = (h) => String(h).padStart(2, '0') + ':00'

/** 「每周一 08:00」「每天 08:00」「手动」。没排期也没老 schedule 的返回 null。 */
export function scheduleText(task) {
  if (task?.run_every === 'week') return t('每{w} {h}', { w: WEEKDAYS[task.run_weekday ?? 1], h: hh(task.run_hour ?? 8) })
  if (task?.run_every === 'day') return t('每天 {h}', { h: hh(task.run_hour ?? 8) })
  if (task?.prompt) return t('手动')
  if (task?.schedule === 'weekly') return t('每周')
  if (task?.schedule) return task.schedule
  return null
}

/** 「9/7 08:00」，按 tz（档案里没填就洛杉矶）。 */
export function fmtLocal(iso, tz = 'America/Los_Angeles') {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d)
    const g = (k) => parts.find((p) => p.type === k)?.value
    return `${g('month')}/${g('day')} ${g('hour')}:${g('minute')}`
  } catch (_) { return String(iso).slice(5, 16).replace('T', ' ') }
}

/**
 * 这条任务现在什么状态，一句人话。
 *   running  正在找……（3 分钟前开始）
 *   queued   排上了，脑子一分钟内接手
 *   next     下次 9/7 08:00
 *   none     （没排期）
 */
export function runState(task, { now = Date.now(), tz } = {}) {
  if (task?.running_since) {
    const min = Math.max(0, Math.round((now - new Date(task.running_since).getTime()) / 60000))
    const ago = min < 1 ? t('刚开始') : min < 60 ? t('{n} 分钟前开始', { n: min }) : t('{n} 小时前开始，可能卡住了', { n: Math.round(min / 60) })
    return { kind: 'running', text: t('正在找……（{ago}）', { ago }) }
  }
  if (task?.run_now) return { kind: 'queued', text: t('排上了，脑子一分钟内接手') }
  if (task?.enabled && task?.next_run_at) return { kind: 'next', text: t('下次 {when}', { when: fmtLocal(task.next_run_at, tz) }) }
  return { kind: 'none', text: '' }
}

/** 面板上那几样能改的。patch 里没给的键不动。run_every 传 'manual' = 取消排期。 */
export async function setTask(id, patch = {}) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  const { data, error } = await supa.rpc('pa_set_task', {
    p_id: id,
    p_enabled: patch.enabled ?? null,
    p_prompt: patch.prompt ?? null,
    p_run_every: patch.run_every ?? null,
    p_run_weekday: patch.run_weekday ?? null,
    p_run_hour: patch.run_hour ?? null,
  })
  if (error) throw new Error(error.message)
  return data
}

/** 「现在跑一次」：拨 run_now，脑子每 30 秒看一眼就接手。关着的任务也能这样跑一次。 */
export async function runTaskNow(id) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  const { error } = await supa.rpc('pa_run_task_now', { p_id: id })
  if (error) throw new Error(error.message)
}

/**
 * 造卡任务分四组。**这是「哪些是真的」的判据，不是排版。**
 *
 * 他 2026-09-03 的原话：手动那几条「后台应该不连任何地方，对不对？」——对。
 * 所以只有第一组能有开关和「开着」；给后三组一个拨不动的开关，就是假着。
 * （跟当初撤掉四个死 tab 是同一条规矩：空着可以，假着不行。）
 *
 *   timed    有提示词 = 脑子到点真会跑它。开关、排期、提示词、现在跑一次
 *   ran      没提示词但跑过 = 他当时手动跑出来的历史。只显示战报，没有开关
 *   origins  卡的出处标记（你自己丢的），不是任务
 *   notYet   还没接的，列个名字
 */
export function groupTasks(tasks = []) {
  const timed = [], ran = [], origins = [], notYet = []
  for (const task of tasks) {
    if (task.prompt) timed.push(task)
    else if (task.last_run_at || (task.last_result && task.last_result !== '未接')) ran.push(task)
    else if (task.type === 'manual') origins.push(task)
    else notYet.push(task)
  }
  return { timed, ran, origins, notYet }
}

/** 卡是「新」的：从来没被点开过。库里 seen_at 是 null；种子数据没这个键，不算新。 */
export const isFresh = (p) => p?.seen_at === null
