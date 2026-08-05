import { supa, DB_CONFIGURED, FELL_BACK } from './backends.js'
import { TASKS_SEED } from '../data/tasksSeed.js'

const seed = (reason, detail) => ({ tasks: TASKS_SEED, source: 'seed', reason, detail })

export async function loadTasks() {
  if (!DB_CONFIGURED) return seed(FELL_BACK.NO_CONFIG)
  try {
    const { data, error } = await supa.from('v_pa_tasks').select('*').order('sort')
    if (error) return seed(FELL_BACK.QUERY_FAILED, error.message)
    if (!data || !data.length) return seed(FELL_BACK.EMPTY)
    return { tasks: data, source: 'live', reason: null }
  } catch (e) {
    return seed(FELL_BACK.QUERY_FAILED, e.message)
  }
}
