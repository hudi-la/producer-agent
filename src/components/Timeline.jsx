import GoogleCalendar, { useGoogleCalendar } from './GoogleCalendar.jsx'
import { googleRows, sourceKey } from '../lib/googleCalendar.js'
import { useEffect, useMemo, useState } from 'react'
import { loadLedger, kindLabel } from '../lib/ledger.js'
import { stateLine } from '../lib/stateText.js'
import { md } from '../lib/when.js'
import { weeksOf, monthMarks, levelOf, dayKey } from '../lib/heat.js'
import Veil from './Veil.jsx'
import { t } from '../i18n/index.js'

// 人名过展示模式；机会线的标题不用——演示的正是这些机会（见 Veil.jsx）
const 谁 = (r) => r.subject_kind === 'pursuit'
  ? (r.subject_name || t("（没名字）"))
  : <Veil>{r.subject_name || t("（没名字）")}</Veil>

function Row({ r, onOpen }) {
  return (
    <div className={'lg-row ' + r.kind}>
      <span className="lg-kind">{kindLabel(r.kind) || r.kind}</span>
      <div className="lg-b">
        <button className="nname" onClick={() => onOpen(r)}>{谁(r)}</button>
        <div className="lg-what">{r.what}</div>
        {r.why && r.kind === 'wait_close' && <div className="lg-why">{t("凭什么算办到：")}{r.why}</div>}
      </div>
      <span className="lg-at">{new Date(r.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  )
}


const weekdays = () => [t("周一"), t("周二"), t("周三"), t("周四"), t("周五"), t("周六"), t("周日")]
const dateOf = (key) => new Date(key + 'T12:00:00')
const shift = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, 12)
const monday = (date) => shift(date, -((date.getDay() + 6) % 7))
const timeOf = (at) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const eventLabel = (r) => r.google ? (r.allDay ? t('全天') : timeOf(r.due_at)) : r.state === 'MEETING_SET' ? timeOf(r.due_at)
  : r.state === 'WAITING_REPLY' ? t("跟进") : r.state === 'NEEDS_REPLY' ? t("待回复") : t("待办")

export default function Timeline({ states = [], onOpen, tick = 0 }) {
  const [tab, setTab] = useState('cal')
  const [view, setView] = useState('month')
  const [anchor, setAnchor] = useState(() => dayKey(new Date()))
  const [selected, setSelected] = useState(() => dayKey(new Date()))
  const [flowDay, setFlowDay] = useState(null)
  const [span, setSpan] = useState(365)
  const [data, setData] = useState(null)
  useEffect(() => {
    let active = true
    loadLedger(span).then((result) => { if (active) setData(result) })
      .catch((error) => { if (active) setData({ days: [], reason: error.message }) })
    return () => { active = false }
  }, [span, tick])
  const today = dayKey(new Date())
  const cursor = dateOf(anchor)
  const start = view === 'month' ? monday(new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12)) : monday(cursor)
  const dates = Array.from({ length: view === 'month' ? 42 : 7 }, (_, i) => shift(start, i))
  const rangeMin = new Date(start.getFullYear(), start.getMonth(), start.getDate()).toISOString()
  const rangeEnd = shift(start, dates.length)
  const rangeMax = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate()).toISOString()
  const calendar = useGoogleCalendar(rangeMin, rangeMax, tick)
  const external = useMemo(() => googleRows(calendar.events, new Date(rangeMin), new Date(rangeMax)), [calendar.events, rangeMin, rangeMax])
  const openItem = (r) => { if (r.google) { if (r.htmlLink) window.open(r.htmlLink, '_blank', 'noopener,noreferrer') } else onOpen(r) }
  const scheduled = useMemo(() => {
    const map = new Map()
    const synced = new Set(external.map((r) => r.source).filter(Boolean))
    for (const r of states) {
      if (synced.has(sourceKey(r))) continue
      if (!r.due_at || !Number.isFinite(new Date(r.due_at).getTime())) continue
      const key = dayKey(new Date(r.due_at))
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    for (const r of external) { if (!map.has(r.day)) map.set(r.day, []); map.get(r.day).push(r) }
    for (const rows of map.values()) rows.sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    return map
  }, [states, external])
  const counts = useMemo(() => new Map((data?.days || []).map(([d, rows]) => [d, rows.length])), [data])
  const weeks = useMemo(() => weeksOf(counts, span), [counts, span])
  const marks = monthMarks(weeks)
  const summary = data?.summary
  const rows = scheduled.get(selected) || []
  const navigate = (direction) => {
    const next = view === 'month'
      ? new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1, 12)
      : shift(cursor, direction * 7)
    setAnchor(dayKey(next)); setSelected(dayKey(next))
  }
  const selectDay = (key) => { setSelected(key); setAnchor(key) }
  return <div className="page"><div className="page-inner lg-inner">
    <header className="page-head">
      <h1>{t("时间线")}</h1>
      <div className="tabs" role="group" aria-label={t("时间线视图")}>
        {[['cal', t("日历")], ['flow', t("Fairwind 动态")]].map(([key, label]) =>
          <button key={key} className={'tab' + (tab === key ? ' on' : '')} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      <p className="note">{tab === 'cal' ? t("你的会议、邮件回复和待办安排。点开事项，查看详情。") : t("Fairwind 的工作、邮件往来和事项进展，都记录在这里。")}</p>
    </header>
    {tab === 'cal' ? <>
      <GoogleCalendar value={calendar} />
      <div className="schedule-toolbar">
        <h2 aria-live="polite">{view === 'month' ? t("{v0} 年 {v1} 月", {v0: cursor.getFullYear(), v1: cursor.getMonth() + 1}) : `${md(dayKey(start))} — ${md(dayKey(shift(start, 6)))} · ${cursor.getFullYear()}`}</h2>
        <div className="schedule-controls">
          <button aria-label={view === 'month' ? t("上个月") : t("上一周")} onClick={() => navigate(-1)}>‹</button>
          <button onClick={() => selectDay(today)}>{t("今天")}</button>
          <button aria-label={view === 'month' ? t("下个月") : t("下一周")} onClick={() => navigate(1)}>›</button>
        </div>
        <div className="schedule-controls" role="group" aria-label={t("日历范围")}>
          {[['month', t("月")], ['week', t("周")]].map(([key, label]) => <button key={key} aria-pressed={view === key} className={view === key ? 'on' : ''} onClick={() => setView(key)}>{label}</button>)}
        </div>
      </div>
      <div className="schedule-scroll">
        <div className={'schedule-grid ' + view}>
          {weekdays().map((d) => <div className="schedule-weekday" key={d}>{d}</div>)}
          {dates.map((date) => {
            const key = dayKey(date), events = scheduled.get(key) || []
            return <div key={key} className={'schedule-day' + (date.getMonth() !== cursor.getMonth() ? ' outside' : '') + (key === selected ? ' selected' : '')}>
              <button className={'schedule-date' + (key === today ? ' today' : '')} aria-label={t("{v0}{v1}，{v2} 项安排", {v0: key, v1: key === today ? t(" 今天") : '', v2: events.length})} aria-pressed={key === selected} onClick={() => selectDay(key)}>{date.getDate()}</button>
              {events.slice(0, view === 'month' ? 3 : events.length).map((r, i) => <button key={i} className={'schedule-event' + (r.google ? ' google' : r.state === 'MEETING_SET' ? ' meeting' : '')} onClick={() => openItem(r)}>
                <span className="schedule-event-meta">{eventLabel(r)}</span>
                <strong>{谁(r)}</strong><span>{r.google ? r.what : r.what || stateLine(r)}</span>
              </button>)}
              {view === 'month' && events.length > 3 && <button className="schedule-more" onClick={() => selectDay(key)}>{t("还有 ")}{events.length - 3}{t(" 项")}</button>}
            </div>
          })}
        </div>
      </div>
      <section className="lg-day" aria-label={t("所选日期的安排")}>
        <h2>{md(selected)}{selected === today ? t(" · 今天") : ''}<span className="lg-n">{rows.length}{t(" 项安排")}</span></h2>
        {rows.map((r, i) => <div className="lg-row todo" key={i}><span className="lg-kind">{eventLabel(r)}</span><div className="lg-b"><button className="nname" onClick={() => openItem(r)}>{谁(r)}</button><div className="lg-what">{r.google ? r.what : r.what || stateLine(r)}</div></div>{!r.google && calendar.status?.connected && calendar.status?.target && <button className="lnk" disabled={calendar.busy} onClick={() => calendar.act('sync', { key: sourceKey(r) })}>{t('写入 Google 日历')}</button>}</div>)}
        {!rows.length && <p className="pnone">{t("这一天没有已安排的事项。")}</p>}
      </section>
      <p className="nnone">{t("显示已记录日期的安排；会议标注时间，其他事项按待办或跟进日期显示。")}</p>
    </> : <>
      {summary && <p className="lg-week">{t("近 7 天：Fairwind 处理 ")}<b>{summary.fairwind}</b>{t(" 次 · 发出 ")}<b>{summary.sent}</b>{t(" 封 · 收到 ")}<b>{summary.got}</b>{t(" 封 · 完成 ")}<b>{summary.closed}</b>{t(" 项 · 新增 ")}<b>{summary.opened}</b>{t(" 个等待")}</p>}
      {!data && <p className="pnone">{t("正在读取动态…")}</p>}
      {data?.reason && <p className="pnone">{t("暂时无法读取动态：")}{data.reason}</p>}
      <div className="lg-cal">
        <div className="lg-cal-scroll">
          <div className="lg-months">{marks.map((m, i) => <span key={i} className="lg-mon">{m}</span>)}</div>
          <div className="lg-grid-wrap"><div className="lg-wd">{[t("一"), '', t("三"), '', t("五"), '', ''].map((d, i) => <span key={i}>{d}</span>)}</div>
            <div className="lg-grid" aria-label={t("活动热力图")}>{weeks.map((week, i) => <div className="lg-col" key={i}>{week.map((cell, j) => cell ? <button key={cell.day} className={'lg-cell lv' + levelOf(cell.n) + (flowDay === cell.day ? ' on' : '')} aria-label={t("{v0}，{v1} 条动态", {v0: cell.day, v1: cell.n})} aria-pressed={flowDay === cell.day} title={t("{v0} · {v1} 条动态", {v0: cell.day, v1: cell.n})} onClick={() => setFlowDay(cell.day)} /> : <span key={j} className="lg-cell blank" />)}</div>)}</div>
          </div>
        </div>
        <div className="lg-legend"><span>{t("近 ")}{span}{t(" 天 · ")}{[...counts.values()].reduce((a, b) => a + b, 0)}{t(" 条动态")}</span><span className="sp" />{t("少")}{[0, 1, 2, 3, 4].map((n) => <i key={n} className={'lg-cell lv' + n} />)}{t("多")}</div>
      </div>
      <p className="nnone">{[90, 365].map((n) => <button key={n} className={'lnk' + (span === n ? ' on' : '')} onClick={() => { setSpan(n); setFlowDay(null) }}>{n === 365 ? t("一年") : t("90 天")} </button>)}{flowDay && <button className="lnk" onClick={() => setFlowDay(null)}>{t("显示全部动态")}</button>}</p>
      {(data?.days || []).filter(([d]) => !flowDay || d === flowDay).map(([d, entries]) => <section className="lg-day" key={d}><h2>{md(d)}<span className="lg-n">{entries.length}{t(" 件")}</span></h2>{entries.map((r, i) => <Row key={i} r={r} onOpen={onOpen} />)}</section>)}
      {data && !data.reason && !(data.days || []).some(([d]) => !flowDay || d === flowDay) && <p className="pnone">{flowDay ? t("这一天没有动态。") : t("这段时间没有动态。")}</p>}
    </>}
  </div></div>
}
