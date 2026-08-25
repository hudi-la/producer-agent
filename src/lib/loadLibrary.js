import { supa, DB_CONFIGURED, FELL_BACK } from './backends.js'
import { ENTRIES_SEED } from '../demo/entries.js'
import { CONCERNS_SEED } from '../demo/concerns.js'

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
    // 连上了但一行没有 = **真的空**,不是假数据的场合。多租户之后这是每个
    // 新账号的第一眼——给他看别人的种子作品是最坏的欢迎方式。
    if (!entries || !entries.length) {
      return { entries: [], concerns: CONCERNS_SEED, source: 'live', reason: FELL_BACK.EMPTY }
    }
    return {
      entries, concerns: meta?.[0]?.concerns ?? CONCERNS_SEED, source: 'live', reason: null,
    }
  } catch (e) {
    return seed(FELL_BACK.QUERY_FAILED, e.message)
  }
}
