import { createClient } from '@supabase/supabase-js'
import { TASKS_SEED } from '../data/tasksSeed.js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
const supa = url && anon ? createClient(url, anon) : null

export async function loadTasks() {
  if (supa) {
    try {
      const { data, error } = await supa.from('v_pa_tasks').select('*').order('sort')
      if (!error && data && data.length) return { tasks: data, source: 'live' }
    } catch (_) {
      // fall through
    }
  }
  return { tasks: TASKS_SEED, source: 'seed' }
}
