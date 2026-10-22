import { dayKey } from './heat.js'
export const sourceKey = (r) => [r.subject_kind, r.subject_id, r.state, r.anchor_id || r.since_at || ''].join(':')
export function googleRows(events, min, max) {
  const out = [], seen = new Set()
  for (const e of events || []) {
    // The same event may be visible through several calendars; preserve distinct copies by calendar ID.
    const id = e.calendarId + ':' + e.id
    if (seen.has(id)) continue
    seen.add(id)
    const allDay = Boolean(e.start?.date)
    const start = allDay ? new Date(e.start.date + 'T00:00:00') : new Date(e.start?.dateTime)
    const end = e.end?.date ? new Date(e.end.date + 'T00:00:00') : new Date(e.end?.dateTime)
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) continue
    const first = new Date(Math.max(+start, +min)), last = Math.min(+end, +max)
    const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate(), 12)
    for (let i = 0; i < 63 && new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()) < last; i++, cursor.setDate(cursor.getDate() + 1)) {
      out.push({ google: true, id, source: e.source, calendarId: e.calendarId, subject_name: e.summary, subject_kind: 'google', what: e.location, allDay,
        day: dayKey(cursor), due_at: start.toISOString(), htmlLink: /^https:\/\/(calendar\.google\.com|www\.google\.com)\//.test(e.htmlLink || '') ? e.htmlLink : null })
    }
  }
  return out
}
