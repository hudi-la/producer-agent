import { supa, DB_CONFIGURED, FELL_BACK } from './backends.js'
import { PURSUITS_SEED, MESSAGES_SEED } from '../data/pursuitsSeed.js'

// 九列并七列之前存进去的卡，stage 还是旧值。0015 那道迁移跑完就没有旧值了，
// 但在跑之前（以及任何还没迁的库上）没有这层翻译，看板会一列都筛不到 —— 卡看着像丢了。
// 留着它不碍事：迁完之后这张表永远命不中。
const LEGACY_STAGE = {
  brief: 'pending',
  proposed: 'matching',
  pick_work: 'matching',
  submitted: 'sent',
  waiting: 'replying',
  declined: 'paused',
  shelved: 'paused',
}
const normalize = (p) => (LEGACY_STAGE[p.stage] ? { ...p, stage: LEGACY_STAGE[p.stage] } : p)

const seed = (reason, detail) => ({
  pursuits: PURSUITS_SEED, messagesByPursuit: MESSAGES_SEED, source: 'seed', reason, detail,
})

export async function loadPursuits() {
  if (!DB_CONFIGURED) return seed(FELL_BACK.NO_CONFIG)
  try {
    const [{ data: pursuits, error: pe }, { data: msgs }] = await Promise.all([
      supa.from('v_pa_pursuits').select('*').order('created_at'),
      supa.from('v_pa_pursuit_messages').select('*').order('created_at'),
    ])
    if (pe) return seed(FELL_BACK.QUERY_FAILED, pe.message)
    if (!pursuits || !pursuits.length) return seed(FELL_BACK.EMPTY)

    const messagesByPursuit = {}
    for (const m of msgs || []) {
      ;(messagesByPursuit[m.pursuit_id] ||= []).push(m)
    }
    return { pursuits: pursuits.map(normalize), messagesByPursuit, source: 'live', reason: null }
  } catch (e) {
    return seed(FELL_BACK.QUERY_FAILED, e.message)
  }
}
