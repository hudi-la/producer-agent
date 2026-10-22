// Per-account daily counters. Never persist prompts, credentials or provider errors.
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
const empty = () => ({ since: new Date().toISOString(), days: {} })
export function readUsage(dir) {
  if (!dir) throw new Error('Usage storage unavailable')
  try { return JSON.parse(readFileSync(join(dir, 'usage.json'), 'utf8')) }
  catch (e) { if (e.code === 'ENOENT') return empty(); throw e }
}
const num = n => Number.isFinite(n) && n >= 0 ? n : 0
export function recordUsage(dir, { provider, model, usage, failed = false }, now = new Date()) {
  const data = readUsage(dir)
  const day = now.toISOString().slice(0, 10)
  const rows = data.days[day] ||= []
  let row = rows.find(r => r.provider === provider && r.model === model)
  if (!row) rows.push(row = { provider, model, calls: 0, failed: 0, measured: 0, input: 0, output: 0, cached: 0 })
  row.calls++; row.failed += Number(failed)
  if (usage) {
    row.measured++
    // Claude separates fresh/cache input; OpenAI-compatible engines include cache in input.
    row.input += num(usage.inp) + (provider.startsWith('claude') ? num(usage.cacheRead) + num(usage.cacheWrite) : 0)
    row.output += num(usage.out); row.cached += num(usage.cacheRead)
  }
  for (const key of Object.keys(data.days)) if (key < new Date(now.getTime() - 365 * 86400000).toISOString().slice(0, 10)) delete data.days[key]
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'usage.json')
  writeFileSync(file + '.tmp', JSON.stringify(data), { mode: 0o600 }); renameSync(file + '.tmp', file)
}
export function usageSummary(dir, days = 30, now = new Date()) {
  const data = readUsage(dir)
  const daily = Array.from({ length: days }, (_, i) => {
    const date = new Date(now.getTime() - (days - 1 - i) * 86400000).toISOString().slice(0, 10)
    return { date, rows: data.days[date] || [] }
  })
  return { since: data.since, timezone: 'UTC', daily }
}
