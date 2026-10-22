import { t } from '../i18n/index.js'
import { reportError } from './reportError.js'
import { errorText } from './userError.js'
// src/lib/modules.js —— 前端读/写模块开关(brain 的 /modules)。
// 脑子没醒时按全开画——跟今天一样,什么都不少;canToggle 为假,设置里不出开关。
import { BRAIN, brainFetch } from './backends.js'

const ALL_ON = { profile: true, pursuits: true, mail: true, canToggle: false }

export async function fetchModules(fetchImpl = brainFetch) {
  try { const r = await fetchImpl(`${BRAIN}/modules`); if (!r.ok) { reportError(`HTTP ${r.status}`, t('读取模块设置失败')); return ALL_ON }; return await r.json() }
  catch (e) { reportError(e, t('读取模块设置失败')); return ALL_ON }
}

export async function postModules(patch, fetchImpl = brainFetch) {
  // 没存成就抛,别把报错当成新的开关状态——那样整个面板和对应的栏都会消失,还回不来(2026-10-03 线上)
  const r = await fetchImpl(`${BRAIN}/modules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error || typeof j.canToggle !== 'boolean') throw new Error(errorText(j.error) || `HTTP ${r.status}`)
  return j
}

/** 给定开关,哪些主区能进。档案和设置永远在;机会线只带「项目争取」;
 *  人际管理、时间线、展开的卡片跟邮件一起开——没有信,人是空的,时间线也没东西转(2026-09-24 他定的)。 */
export function allowedAreas(mods) {
  const out = []
  if (mods?.mail) out.push('desk')
  if (mods?.pursuits) out.push('pursue')
  if (mods?.mail) out.push('people', 'ledger')
  return out.concat(['profile', 'settings'])
}
