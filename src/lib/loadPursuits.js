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

// 首页**不再拉消息**。
//
// 原来为了算小红点（「每张卡的最后一条消息是谁说的」），这儿每 8 秒把全库消息
// 拉一遍。PostgREST 默认封顶 1000 行 —— 过了这个数它只返回**最老的** 1000 条，
// 新消息静悄悄不在里面，红点开始漏报而且不报错。
//
// 现在这个判据算在 v_pa_pursuits 里（0030），前端只读 p.unread 一个布尔。
// 详情页要的往来由 PursuitFocus 自己 fetchMessages 单条拉。
export async function loadPursuits() {
  if (!DB_CONFIGURED) return seed(FELL_BACK.NO_CONFIG)
  try {
    const { data: pursuits, error: pe } = await supa
      .from('v_pa_pursuits').select('*').order('created_at')
    if (pe) return seed(FELL_BACK.QUERY_FAILED, pe.message)
    if (!pursuits || !pursuits.length) return seed(FELL_BACK.EMPTY)

    return { pursuits: pursuits.map(normalize), messagesByPursuit: {}, source: 'live', reason: null }
  } catch (e) {
    return seed(FELL_BACK.QUERY_FAILED, e.message)
  }
}
