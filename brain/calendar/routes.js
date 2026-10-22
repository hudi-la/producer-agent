const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
async function bodyOf(req) { let raw = ''; for await (const c of req) { raw += c; if (raw.length > 16000) throw Object.assign(new Error('calendar_request_too_large'), { status: 413 }) } try { return JSON.parse(raw || '{}') } catch { throw Object.assign(new Error('calendar_invalid_request'), { status: 400 }) } }
export async function calendarRows(t) { const { data, error } = await t.db.from('v_pa_state').select('*'); if (error) throw new Error('calendar_states_unavailable'); return data || [] }
export async function handleCalendarRoute(req, res, { service, tenant }) {
  const u = new URL(req.url, 'http://localhost')
  if (!u.pathname.startsWith('/calendar/')) return false
  const t = tenant()
  if (!t?.owner || t.mode !== 'hosted') { json(res, 401, { error: 'calendar_sign_in' }); return true }
  try {
    let out
    if (req.method === 'GET' && u.pathname === '/calendar/status') out = await service.status(t.owner)
    else if (req.method === 'GET' && u.pathname === '/calendar/list') out = await service.list(t.owner)
    else if (req.method === 'GET' && u.pathname === '/calendar/events') out = await service.events(t.owner, u.searchParams.get('min'), u.searchParams.get('max'))
    else if (req.method === 'POST' && u.pathname === '/calendar/connect') out = service.start(t.owner, t.settings.gmailAddress || t.email)
    else if (req.method === 'POST' && u.pathname === '/calendar/disconnect') { await service.disconnect(t.owner); out = { connected: false } }
    else if (req.method === 'POST' && u.pathname === '/calendar/settings') out = await service.configure(t.owner, await bodyOf(req))
    else if (req.method === 'POST' && u.pathname === '/calendar/sync') {
      const body = await bodyOf(req)
      if (body.key !== undefined && typeof body.key !== 'string') throw new Error('calendar_invalid_request')
      out = await service.sync(t.owner, await calendarRows(t), { key: body.key, lang: t.settings.lang })
    } else { json(res, 404, { error: 'calendar_not_found' }); return true }
    json(res, 200, out)
  } catch (e) { json(res, e.status || 400, { error: e.message?.startsWith('calendar_') ? e.message : 'calendar_unavailable' }) }
  return true
}
