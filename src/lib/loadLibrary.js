import { supa, DB_CONFIGURED, FELL_BACK } from './backends.js'
import { ENTRIES_SEED, CONCERNS_SEED } from '../data/entriesSeed.js'

// 读 public 里的 v_pa_* 视图（指向 producer schema）。连不上就退回种子数据，
// 保证界面永远渲染得出来——但会把「为什么退回」带出去，让界面说清楚。
const seed = (reason, detail) => ({
  entries: ENTRIES_SEED, concerns: CONCERNS_SEED, source: 'seed', reason, detail,
})

export async function loadLibrary() {
  if (!DB_CONFIGURED) return seed(FELL_BACK.NO_CONFIG)
  try {
    const [{ data: entries, error: ee }, { data: meta }] = await Promise.all([
      supa.from('v_pa_entries').select('*').order('sort'),
      supa.from('v_pa_meta').select('concerns').limit(1),
    ])
    if (ee) return seed(FELL_BACK.QUERY_FAILED, ee.message)
    if (!entries || !entries.length) return seed(FELL_BACK.EMPTY)
    return {
      entries, concerns: meta?.[0]?.concerns ?? CONCERNS_SEED, source: 'live', reason: null,
    }
  } catch (e) {
    return seed(FELL_BACK.QUERY_FAILED, e.message)
  }
}
