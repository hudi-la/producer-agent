// src/lib/modules.js —— 前端读/写模块开关(brain 的 /modules)。
// 脑子没醒时按全开画——跟今天一样,什么都不少;canToggle 为假,设置里不出开关。
import { BRAIN } from './backends.js'

const ALL_ON = { profile: true, pursuits: true, mail: true, canToggle: false }

export async function fetchModules(fetchImpl = (...a) => globalThis.fetch(...a)) {
  try { const r = await fetchImpl(`${BRAIN}/modules`); return r.ok ? await r.json() : ALL_ON }
  catch { return ALL_ON }
}

export async function postModules(patch, fetchImpl = (...a) => globalThis.fetch(...a)) {
  const r = await fetchImpl(`${BRAIN}/modules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
  return r.json()
}

/** 给定开关,哪些主区能进。档案永远在;其余四个都是机会线模块的。 */
export function allowedAreas(mods) {
  return (mods?.pursuits ? ['desk', 'pursue', 'people', 'ledger'] : []).concat(['profile'])
}
