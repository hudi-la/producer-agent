import { useCallback, useEffect, useRef, useState } from 'react'
import { brainFetch } from '../lib/backends.js'
import { t } from '../i18n/index.js'
function calendarError(code) {
  const messages = {
    "calendar_api_disabled": t("Google 日历服务尚未启用，授权已保留。请联系应用管理员启用 Calendar API 后重试。"),
    "calendar_expired": t("授权已过期，请重新连接日历。"),
    "calendar_declined": t("尚未完成日历授权，你可以稍后重新连接。"),
    "calendar_scope_missing": t("请在 Google 授权页勾选日历所需的全部权限。"),
    "calendar_token_missing": t("Google 未返回长期授权，请重新连接。"),
    "calendar_not_connected": t("请先连接 Google 日历。"),
    "calendar_reconnect": t("Google 日历授权已失效，请重新授权。"),
    "calendar_permission_or_api": t("Google 日历访问被拒绝，请检查授权；应用管理员也需启用 Google Calendar API。"),
    "calendar_not_writable": t("你没有这个日历的写入权限。"),
    "calendar_select_target": t("请先选择写入日历。"),
    "calendar_invalid_selection": t("请选择有效的日历，最多显示 12 个。"),
    "calendar_item_changed": t("这项安排已变化，请刷新后重试。"),
    "calendar_conflict": t("有日程已在 Google 中修改或删除，Fairwind 保留了你的修改。请在 Google 日历核对。"),
    "calendar_unavailable": t("暂时无法连接 Google 日历，请重试。"),
    "calendar_states_unavailable": t("暂时无法读取 Fairwind 安排，请重试。"),
    "calendar_too_many_events": t("这个时间段日程太多，请减少显示的日历。"),
    "calendar_sign_in": t("请先登录 Fairwind。"),
  }
  return messages[code] || messages.calendar_unavailable
}
export async function calendarRequest(path, body) {
  const res = await brainFetch('/calendar/' + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'calendar_unavailable')
  return data
}
export function useGoogleCalendar(min, max, tick) {
  const [status, setStatus] = useState(null), [calendars, setCalendars] = useState([]), [events, setEvents] = useState([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  const generation = useRef(0), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++ } }, [])
  const reload = useCallback(() => setRevision((n) => n + 1), [])
  useEffect(() => {
    const seq = ++generation.current
    const valid = () => mounted.current && seq === generation.current
    setEvents([])
    ;(async () => {
      const state = await calendarRequest('status')
      if (!valid()) return
      setStatus(state)
      if (!state.connected) { setCalendars([]); return }
      const [list, result] = await Promise.all([calendarRequest('list'), min && max ? calendarRequest('events?' + new URLSearchParams({ min, max })) : Promise.resolve({ events: [] })])
      if (!valid()) return
      setStatus(list); setCalendars(list.calendars); setEvents(result.events); setError('')
    })().catch((e) => { if (valid()) setError(e.message) })
  }, [min, max, tick, revision])
  useEffect(() => {
    const u = new URL(location.href), result = u.searchParams.get('calendar')
    if (result) { if (result !== 'connected') setError(result); u.searchParams.delete('calendar'); history.replaceState(history.state, '', u) }
  }, [])
  async function act(path, body = {}) {
    setBusy(true); setError('')
    try {
      const result = await calendarRequest(path, body)
      if (path === 'connect') { const url = new URL(result.url); if (url.origin !== 'https://accounts.google.com') throw new Error('calendar_unavailable'); location.assign(url.href); return }
      if (result.conflicts?.length) setError('calendar_conflict')
      if (path === 'disconnect') { generation.current++; setEvents([]); setStatus({ connected: false }); setCalendars([]) }
      reload(); return result
    } catch (e) { setError(e.message) } finally { if (mounted.current) setBusy(false) }
  }
  return { status, calendars, events, error, busy, act, reload }
}
export default function GoogleCalendar({ value }) {
  const { status, calendars, error, busy, act, reload } = value
  const [expanded, setExpanded] = useState(false)
  return <section className="google-calendar" aria-label={t('Google 日历')}>
    <div className="google-calendar-head"><strong>{t('Google 日历')}</strong>
      {status?.connected ? <><span>{status.address || t("授权已保存，正在确认日历账号。")}</span><button disabled={busy} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{t('日历设置')}</button><button disabled={busy} onClick={reload}>{t('刷新日程')}</button></>
        : <><span>{t('连接自己的 Google 日历，查看会议并写入安排。')}</span><button disabled={busy || !status} onClick={() => act('connect')}>{t('连接 Google 日历')}</button></>}
    </div>
    {(error || status?.syncError) && <p className="google-calendar-error" role="alert">{calendarError(error || status.syncError)} <button disabled={busy} onClick={reload}>{t('重试')}</button>{status?.connected && <button disabled={busy} onClick={() => act('connect')}>{t('重新授权')}</button>}</p>}
    {status?.conflicts?.length > 0 && <p role="status">{calendarError('calendar_conflict')}</p>}
    {status?.connected && expanded && <div className="google-calendar-settings">
      <fieldset disabled={busy}><legend>{t('显示的日历')}</legend>{calendars.map((c) => <label key={c.id}><input type="checkbox" checked={(status.visible || []).includes(c.id) || c.primary && (status.visible || []).includes('primary')} onChange={(e) => {
        const visible = (status.visible || []).filter((id) => id !== c.id && !(c.primary && id === 'primary'))
        act('settings', { visible: e.target.checked ? [...visible, c.id] : visible })
      }} />{c.name}</label>)}</fieldset>
      <label>{t('将安排写入')} <select disabled={busy} value={status.target || ''} onChange={(e) => act('settings', { target: e.target.value })}><option value="">{t('选择日历')}</option>{calendars.filter((c) => c.writable).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {!status.target && <button disabled={busy} onClick={() => act('settings', { create: true })}>{t('新建 Fairwind 日历')}</button>}
      <label><input type="checkbox" disabled={busy || !status.target} checked={status.autoSync === true} onChange={(e) => act('settings', { autoSync: e.target.checked })} />{t('自动同步已确认的未来会议（每 5 分钟）')}</label>
      <p>{t('会议默认 30 分钟，可在 Google 修改；待办手动加入为全天安排。不会向参会者发送邀请。')}</p>
      <button disabled={busy || !status.target} onClick={() => act('sync')}>{t('立即同步已确认会议')}</button>
      <button disabled={busy} onClick={() => act('disconnect')}>{t('断开日历连接')}</button>
      <p>{t('断开后停止读写，Google 中已有日程会保留，Gmail 连接不受影响。')}</p>
    </div>}
  </section>
}

// Settings only needs connection/preferences; do not fetch calendar events here.
export function GoogleCalendarSettings() {
  const calendar = useGoogleCalendar()
  return <GoogleCalendar value={calendar} />
}
