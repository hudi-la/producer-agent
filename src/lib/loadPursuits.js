import { createClient } from '@supabase/supabase-js'
import { PURSUITS_SEED, MESSAGES_SEED } from '../data/pursuitsSeed.js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
const supa = url && anon ? createClient(url, anon) : null

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

export async function loadPursuits() {
  if (supa) {
    try {
      const [{ data: pursuits, error: pe }, { data: msgs }] = await Promise.all([
        supa.from('v_pa_pursuits').select('*').order('created_at'),
        supa.from('v_pa_pursuit_messages').select('*').order('created_at'),
      ])
      if (!pe && pursuits && pursuits.length) {
        const messagesByPursuit = {}
        for (const m of msgs || []) {
          ;(messagesByPursuit[m.pursuit_id] ||= []).push(m)
        }
        return { pursuits: pursuits.map(normalize), messagesByPursuit, source: 'live' }
      }
    } catch (_) {
      // fall through to seed
    }
  }
  return { pursuits: PURSUITS_SEED, messagesByPursuit: MESSAGES_SEED, source: 'seed' }
}
