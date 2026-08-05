import { createClient } from '@supabase/supabase-js'
import { ENTRIES_SEED, CONCERNS_SEED } from '../data/entriesSeed.js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
// Reads public views (v_pa_*) that point at the producer schema. Falls back to
// seed if env vars are missing or the query fails, so the app always renders.
const supa = url && anon ? createClient(url, anon) : null

export async function loadLibrary() {
  if (supa) {
    try {
      const [{ data: entries, error: ee }, { data: meta }] = await Promise.all([
        supa.from('v_pa_entries').select('*').order('sort'),
        supa.from('v_pa_meta').select('concerns').limit(1),
      ])
      if (!ee && entries && entries.length) {
        return { entries, concerns: meta?.[0]?.concerns ?? CONCERNS_SEED, source: 'live' }
      }
    } catch (_) {
      // fall through to seed
    }
  }
  return { entries: ENTRIES_SEED, concerns: CONCERNS_SEED, source: 'seed' }
}
