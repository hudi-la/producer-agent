import { randomBytes, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.calendars']
export const sourceKey = (r) => [r.subject_kind, r.subject_id, r.state, r.anchor_id || r.since_at || ''].join(':')
const digest = (value) => createHash('sha256').update(value).digest('hex')
const fail = (code, status = 400) => Object.assign(new Error(code), { status })
export function calendarErrorCode(e) {
  const err = e.response?.data?.error
  const reasons = [err?.status, ...(err?.errors || []).map((x) => x.reason), ...(err?.details || []).map((x) => x.reason)]
  if (reasons.some((r) => ['SERVICE_DISABLED', 'accessNotConfigured'].includes(r))) return 'calendar_api_disabled'
  if (e.message?.startsWith('calendar_')) return e.message
  if (Number(e.code || e.response?.status) === 401 || err === 'invalid_grant') return 'calendar_reconnect'
  if (Number(e.code || e.response?.status) === 403) return 'calendar_permission_or_api'
  return 'calendar_unavailable'
}
const dayIn = (at, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
const nextDay = (day) => new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
export function eventBody(r, tz, origin, lang = 'zh') {
  if (!r?.subject_id || !r?.due_at || !Number.isFinite(Date.parse(r.due_at))) throw fail('calendar_invalid_item')
  const meeting = r.state === 'MEETING_SET'
  const date = dayIn(r.due_at, tz)
  return {
    summary: (r.subject_name || 'Fairwind') + (r.what ? ' · ' + r.what : ''),
    description: `${r.what || ''}\n\nFairwind: ${origin}/?a=ledger` + (meeting ? (lang === 'en' ? '\nDuration defaults to 30 minutes; edit in Google Calendar.' : '\n默认时长 30 分钟，可在 Google 日历修改。') : ''),
    start: meeting ? { dateTime: new Date(r.due_at).toISOString(), timeZone: tz } : { date },
    end: meeting ? { dateTime: new Date(Date.parse(r.due_at) + 30 * 60000).toISOString(), timeZone: tz } : { date: nextDay(date) },
    extendedProperties: { private: { fairwindSource: sourceKey(r) } },
  }
}
// Compare only fields Fairwind manages. Google-side edits to those fields are never overwritten.
export const fingerprint = (event) => digest(JSON.stringify({ summary: event.summary || '', description: event.description || '', start: event.start, end: event.end }))
export function publicState(s) {
  return { connected: Boolean(s.refreshToken || s.pendingRefreshToken), address: s.pendingRefreshToken ? '' : s.address || '', visible: s.visible || [], target: s.target || '', autoSync: s.autoSync === true, lastSync: s.lastSync || null, syncError: s.syncError || null, conflicts: s.conflicts || [] }
}
export function createCalendarService({ root, makeClient, makeApi, origin, now = Date.now }) {
  const pending = new Map(), locks = new Map()
  const pathFor = (owner) => { if (!/^[a-zA-Z0-9-]{1,100}$/.test(owner)) throw fail('calendar_bad_owner'); return join(root, 'users', owner, 'calendar.json') }
  async function load(owner) { try { return JSON.parse(await readFile(pathFor(owner), 'utf8')) } catch (e) { if (e.code === 'ENOENT') return {}; throw e } }
  async function save(owner, value) { const path = pathFor(owner); await mkdir(join(root, 'users', owner), { recursive: true, mode: 0o700 }); const tmp = path + '.' + randomBytes(6).toString('hex'); await writeFile(tmp, JSON.stringify(value), { mode: 0o600 }); await rename(tmp, path) }
  async function lock(owner, fn) {
    const prev = locks.get(owner) || Promise.resolve()
    const next = prev.catch(() => {}).then(fn); locks.set(owner, next)
    try { return await next } finally { if (locks.get(owner) === next) locks.delete(owner) }
  }
  function start(owner, hint) {
    pathFor(owner)
    for (const [k, v] of pending) if (now() - v.at > 600000) pending.delete(k)
    if (pending.size > 500) throw fail('calendar_busy', 429)
    const state = 'calendar-' + randomBytes(24).toString('hex')
    const verifier = randomBytes(32).toString('base64url')
    const url = makeClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state, login_hint: hint || undefined, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })
    pending.set(state, { owner, at: now(), verifier }); return { url }
  }
  async function resolveProfile(owner, s, api) {
    const { data: primary } = await api.calendars.get({ calendarId: 'primary' })
    if (!primary.id) throw fail('calendar_unavailable')
    const same = s.address === primary.id
    const next = { ...(same ? s : {}), address: primary.id, refreshToken: s.pendingRefreshToken,
      visible: same ? (s.visible || ['primary']) : ['primary'], timeZone: primary.timeZone || 'UTC', syncError: null }
    delete next.pendingRefreshToken
    for (const k of Object.keys(s)) delete s[k]
    Object.assign(s, next)
    await save(owner, s)
  }
  async function callback(state, code, error) {
    const p = pending.get(state); pending.delete(state)
    if (!p || now() - p.at > 600000) throw fail('calendar_expired')
    return lock(p.owner, async () => {
      const old = await load(p.owner)
      try {
        if (error || !code) throw fail('calendar_declined')
        const c = makeClient(), { tokens } = await c.getToken({ code, codeVerifier: p.verifier })
        const scopes = String(tokens.scope || '').split(/\s+/)
        if (!scopes.includes('https://www.googleapis.com/auth/calendar') && !SCOPES.every((scope) => scopes.includes(scope))) throw fail('calendar_scope_missing')
        if (!tokens.refresh_token) throw fail('calendar_token_missing')
        // Persist the grant before any Calendar API request. An API outage must not discard consent.
        old.pendingRefreshToken = tokens.refresh_token; old.syncError = null
        await save(p.owner, old)
        c.setCredentials(tokens)
        await resolveProfile(p.owner, old, makeApi(c))
        return p.owner
      } catch (e) {
        const code = calendarErrorCode(e)
        old.syncError = code; await save(p.owner, old)
        console.warn('Calendar authorization: ' + code)
        throw fail(code)
      }
    })
  }
  async function using(owner, fn) {
    return lock(owner, async () => {
      const s = await load(owner)
      if (!s.refreshToken && !s.pendingRefreshToken) throw fail('calendar_not_connected', 409)
      const c = makeClient(); c.setCredentials({ refresh_token: s.pendingRefreshToken || s.refreshToken })
      try { const api = makeApi(c); if (s.pendingRefreshToken) await resolveProfile(owner, s, api); const result = await fn(api, s); if (c.credentials?.refresh_token) s.refreshToken = c.credentials.refresh_token; await save(owner, s); return result }
      catch (e) {
        const status = Number(e.code || e.response?.status || e.status)
        const code = calendarErrorCode(e)
        s.syncError = code; await save(owner, s); throw fail(code, status === 429 ? 429 : 400)
      }
    })
  }
  async function calendars(api) {
    const out = []; let pageToken
    do { const { data } = await api.calendarList.list({ maxResults: 250, pageToken }); out.push(...(data.items || []).filter((x) => !x.deleted)); pageToken = data.nextPageToken } while (pageToken)
    return out.map((x) => ({ id: x.id, name: x.summaryOverride || x.summary || x.id, primary: x.primary === true, writable: ['writer', 'owner'].includes(x.accessRole), color: x.backgroundColor, timeZone: x.timeZone }))
  }
  const status = async (owner) => publicState(await load(owner))
  const list = (owner) => using(owner, async (api, s) => ({ ...publicState(s), calendars: await calendars(api) }))
  async function configure(owner, patch) {
    return using(owner, async (api, s) => {
      const all = await calendars(api)
      if (patch.create) {
        if (!s.target) { const { data } = await api.calendars.insert({ requestBody: { summary: 'Fairwind', timeZone: s.timeZone || 'UTC' } }); s.target = data.id; s.visible = [...new Set([...(s.visible || []), data.id])]; await save(owner, s) }
      }
      if (patch.target !== undefined) {
        if (patch.target && !all.some((x) => x.id === patch.target && x.writable)) throw fail('calendar_not_writable')
        s.target = patch.target; const chosen = all.find((x) => x.id === s.target); if (chosen?.timeZone) s.timeZone = chosen.timeZone; if (!s.target) s.autoSync = false
      }
      if (patch.visible !== undefined) {
        if (!Array.isArray(patch.visible) || patch.visible.length > 12 || !patch.visible.every((id) => id === 'primary' || all.some((x) => x.id === id))) throw fail('calendar_invalid_selection')
        s.visible = [...new Set(patch.visible)]
      }
      if (patch.autoSync !== undefined) { if (typeof patch.autoSync !== 'boolean') throw fail('calendar_invalid_selection'); if (patch.autoSync && !s.target) throw fail('calendar_select_target'); s.autoSync = patch.autoSync }
      s.syncError = null; return publicState(s)
    })
  }
  async function events(owner, min, max) {
    const start = Date.parse(min), end = Date.parse(max)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 63 * 86400000) throw fail('calendar_invalid_range')
    return using(owner, async (api, s) => {
      const out = []
      for (const id of s.visible || []) {
        let pageToken
        do {
          const { data } = await api.events.list({ calendarId: id, timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 2500, pageToken })
          for (const e of data.items || []) if (e.status !== 'cancelled') out.push({ id: e.id, calendarId: id, summary: e.summary || '', start: e.start, end: e.end, location: e.location || '', htmlLink: e.htmlLink, source: e.extendedProperties?.private?.fairwindSource || null })
          pageToken = data.nextPageToken
          if (out.length > 15000) throw fail('calendar_too_many_events')
        } while (pageToken)
      }
      return { events: out }
    })
  }
  async function put(api, s, owner, row, lang) {
    if (!s.target) throw fail('calendar_select_target')
    const source = sourceKey(row), mapKey = digest(s.target + ':' + source)
    const id = digest(owner + ':' + mapKey) // deterministic, valid base32hex: retry after timeout cannot duplicate
    const body = eventBody(row, s.timeZone || 'UTC', origin, lang), desired = fingerprint(body)
    s.links ||= {}; const known = s.links[mapKey]
    let current
    try { current = (await api.events.get({ calendarId: s.target, eventId: id })).data }
    catch (e) { if (![404, 410].includes(Number(e.code || e.response?.status))) throw e }
    if (known && !current || current?.status === 'cancelled') return { source, status: 'conflict' }
    if (current) {
      if (current.extendedProperties?.private?.fairwindSource !== source) throw fail('calendar_event_conflict')
      const actual = fingerprint(current)
      if (!known) {
        // Recover a completed insert whose response was lost, without writing it again.
        const sameTime = (a, b) => a?.date ? a.date === b?.date : Date.parse(a?.dateTime) === Date.parse(b?.dateTime)
        if (current.summary !== body.summary || current.description !== body.description || !sameTime(current.start, body.start) || !sameTime(current.end, body.end)) return { source, status: 'conflict' }
      } else if (actual !== known.google) return { source, status: 'conflict' }
      if (known && desired !== known.desired) {
        try { current = (await api.events.patch({ calendarId: s.target, eventId: id, requestBody: body }, { headers: { 'If-Match': current.etag } })).data } catch (e) { if (Number(e.code || e.response?.status) === 412) return { source, status: 'conflict' }; throw e }
      }
    } else {
      try { current = (await api.events.insert({ calendarId: s.target, requestBody: { id, ...body } })).data }
      catch (e) { if (Number(e.code || e.response?.status) === 409) return { source, status: 'conflict' }; throw e }
    }
    s.links[mapKey] = { desired, google: fingerprint(current), id }; return { source, status: 'synced', htmlLink: current.htmlLink }
  }
  async function sync(owner, rows, { key, lang = 'zh', automatic = false } = {}) {
    return using(owner, async (api, s) => {
      if (automatic && !s.autoSync) return { results: [] }
      const targets = key ? rows.filter((r) => sourceKey(r) === key) : rows.filter((r) => r.state === 'MEETING_SET' && Date.parse(r.due_at) >= now() && Date.parse(r.due_at) <= now() + 180 * 86400000)
      if (key && targets.length !== 1) throw fail('calendar_item_changed', 409)
      const results = []
      for (const row of targets) { results.push(await put(api, s, owner, row, lang)); await save(owner, s) }
      s.lastSync = new Date(now()).toISOString(); s.conflicts = results.filter((x) => x.status === 'conflict').map((x) => x.source); s.syncError = null
      return { results, ...publicState(s) }
    })
  }
  // Do not call Google's revoke endpoint: a shared OAuth project can also revoke the Gmail grant.
  const disconnect = (owner) => lock(owner, () => { for (const [state, p] of pending) if (p.owner === owner) pending.delete(state); return save(owner, {}) })
  async function owners() { try { const dirs = await readdir(join(root, 'users')); const out = []; for (const owner of dirs) { if (!/^[a-zA-Z0-9-]{1,100}$/.test(owner)) continue; const s = await load(owner); if (s.refreshToken && s.autoSync) out.push(owner) } return out } catch (e) { if (e.code === 'ENOENT') return []; throw e } }
  return { start, callback, status, list, configure, events, sync, disconnect, owners, _load: load }
}
