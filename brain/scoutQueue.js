// A scout search is a durable queue, derived from the editable task prompt.
// Keep only URLs and search instructions as work items; the rest of the prompt
// remains the model's selection criteria. Changing the prompt starts a new queue.
import { createHash } from 'node:crypto'

const clean = (s) => String(s || '').trim()
const urlKey = (s) => clean(s).replace(/[),.;]+$/, '').replace(/\/+$/, '')
export const promptVersion = (prompt) => createHash('sha256').update(clean(prompt)).digest('hex')

export function scoutSources(prompt) {
  const seen = new Set(), units = []
  const add = (kind, value) => {
    const key = `${kind}:${value.toLowerCase()}`
    if (!value || seen.has(key)) return
    seen.add(key); units.push({ kind, value, done: false })
  }
  for (const raw of clean(prompt).split(/\r?\n/)) {
    const line = raw.trim()
    const urls = [...line.matchAll(/https?:\/\/[^\s<>"'）)]+/g)].map((m) => urlKey(m[0]))
    for (const url of urls) add('source', url)
    // Search bullets may be quoted English queries or free-form Chinese instructions.
    if (!urls.length && /^(?:[-*•]\s*)?(?:["“].+["”]|.*(?:WebSearch|搜索|search for|search query|open call|call for artists|artist residency).*)/i.test(line)
      && !/^(?:==|#|【[一二三四五六七八九十]+】|\[[IVX]+\])/.test(line)
      && line.length >= 12 && line.length <= 260) {
      add('search', line.replace(/^[-*•]\s*/, ''))
    }
  }
  if (!units.length) add('general', 'Find current art opportunities matching this prompt')
  return units
}

export function freshScoutQueue(prompt, at = new Date().toISOString()) {
  return { version: promptVersion(prompt), started_at: at, updated_at: at, status: 'running',
    units: scoutSources(prompt), candidates: [], completed: 0, added: 0, skipped: 0, note: null }
}

export function resumeScoutQueue(saved, prompt, at = new Date().toISOString()) {
  if (saved?.version === promptVersion(prompt) && Array.isArray(saved.units) && Array.isArray(saved.candidates)) {
    return { ...saved, status: 'running', updated_at: at, note: null }
  }
  return freshScoutQueue(prompt, at)
}

export function addCandidates(queue, urls, source) {
  const known = new Set(queue.candidates.map((c) => urlKey(c.url).toLowerCase()))
  for (const raw of urls) {
    const url = urlKey(raw)
    if (!/^https?:\/\//i.test(url) || known.has(url.toLowerCase())) continue
    known.add(url.toLowerCase())
    queue.candidates.push({ url, source, done: false, result: null })
  }
  return queue
}

export function parseCandidates(text) {
  const m = String(text || '').match(/\[\[CANDIDATES\]\]\s*(\{[\s\S]*\})\s*$/)
  if (!m) return null
  try {
    const raw = JSON.parse(m[1])
    return Array.isArray(raw.urls) ? raw.urls.filter((x) => typeof x === 'string') : null
  } catch { return null }
}

export const queueRemaining = (q) => (q.units?.filter((x) => !x.done).length || 0)
  + (q.candidates?.filter((x) => !x.done).length || 0)
