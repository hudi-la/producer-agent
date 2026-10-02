// src/lib/modules.js —— 前端读/写模块开关(brain 的 /modules)。
// 脑子没醒时按全开画——跟今天一样,什么都不少;canToggle 为假,设置里不出开关。
import { BRAIN, brainFetch } from './backends.js'

const ALL_ON = { profile: true, pursuits: true, mail: true, canToggle: false }

export async function fetchModules(fetchImpl = brainFetch) {
  try { const r = await fetchImpl(`${BRAIN}/modules`); return r.ok ? await r.json() : ALL_ON }
  catch { return ALL_ON }
}

export async function postModules(patch, fetchImpl = brainFetch) {
  const r = await fetchImpl(`${BRAIN}/modules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
  return r.json()
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
