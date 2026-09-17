import { useEffect, useMemo, useRef, useState } from 'react'
import { loadLedger, KIND_LABEL, isMine } from '../lib/ledger.js'
import { md } from '../lib/when.js'
import { weeksOf, monthMarks, levelOf, dayKey } from '../lib/heat.js'
import Veil from './Veil.jsx'

// 「时间线」——两半：日历（你动的手）和流水（不是你动的手）。
//
// 这一页最早叫「流水」，只有一条往下排的账（2026-08-20）：系统自己比对出
// 「这事办到了」的时候他想要一点心安，但不要提醒 —— 所以是 pull 不是 push。
// 8/22 排法换成 GitHub 那种年度方格：流水回答的是**形状**问题（这阵子动没动、
// 哪几周连着、哪几天断了），一天一段往下排的话，想知道「上个月有没有停过」
// 得滚三屏。
//
// 8/23 再分两半（他拍的）。分的不是时间，是**谁动的手**：
//   日历 —— 你发出的信、你记的一笔、办到了的那些（已办），
//           加上还没到点的那些（待办，v_pa_state 的 due_at）。方格。
//   流水 —— 收到的信、Fairwind 到点干的事、系统开的等待。一条流。
// 两个问题本来就不一样：「这个月我干了多少、还欠着什么」是形状，
// 「刚刚发生了什么」是顺序。一种排法答不好两个问题。
//
// 每一行都是现算的，永远不会跟事实分叉；点名字进卡对证。

// 人名过展示模式；机会线的标题不用——演示的正是这些机会（见 Veil.jsx）
const 谁 = (r) => r.subject_kind === 'pursuit'
  ? (r.subject_name || '（没名字）')
  : <Veil>{r.subject_name || '（没名字）'}</Veil>

function Row({ r, onOpen }) {
  return (
    <div className={'lg-row ' + r.kind}>
      <span className="lg-kind">{KIND_LABEL[r.kind] || r.kind}</span>
      <div className="lg-b">
        <button className="nname" onClick={() => onOpen(r)}>{谁(r)}</button>
        <div className="lg-what">{r.what}</div>
        {r.why && r.kind === 'wait_close' && <div className="lg-why">凭什么算办到：{r.why}</div>}
      </div>
      <span className="lg-at">{new Date(r.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  )
}

const WEEKDAY = ['一', '', '三', '', '五', '', '']   // 跟 GitHub 一样隔行标，七行都标太吵

export default function Timeline({ states = [], onOpen, tick = 0 }) {
  // 日历 / 流水：看哪一半。切换从导航带子搬进页里（2026-09-02）——它不是「去哪儿」，
  // 是「看哪一半」；两半都得看得见，撤掉切换让日历不可见就是丢信息。
  const [tab, setTab] = useState('cal')
  const [data, setData] = useState(null)
  const [span, setSpan] = useState(365)
  const [pickedDay, setPickedDay] = useState(null)
  const gridRef = useRef(null)
  // tick 是 App 那个「现在」的心跳（App.jsx 的 FACTS_MS）。挂上它，流水和
  // 通知栏就是同一个时刻的两半 —— 不挂的话反过来也一样会分叉：面板刷新了、
  // 一个等待关掉不见了，这边的流水却还没记上那一笔。
  useEffect(() => { loadLedger(span).then(setData) }, [span, tick])

  // 已办：你动的手那几种（发出 / 记一笔 / 办到了）。
  // 收到的信和 Fairwind 干的事不进日历 —— 那不是你办的，堆进来只会
  // 把「我这个月干了多少」这个问题答歪。
  const doneByDay = useMemo(() => {
    const m = new Map()
    for (const [d, rows] of data?.days || []) {
      const mine = rows.filter(isMine)
      if (mine.length) m.set(d, mine)
    }
    return m
  }, [data])

  // 待办：还没到点的那些，按 due_at 落到日子上（v_pa_state，跟 🔔 同一份）。
  const todoByDay = useMemo(() => {
    const m = new Map()
    for (const r of states || []) {
      if (!r.due_at) continue
      const d = dayKey(new Date(r.due_at))
      if (!m.has(d)) m.set(d, [])
      m.get(d).push(r)
    }
    return m
  }, [states])

  const counts = useMemo(() => {
    const m = new Map()
    for (const [d, rows] of doneByDay) m.set(d, rows.length)
    for (const [d, rows] of todoByDay) m.set(d, (m.get(d) || 0) + rows.length)
    return m
  }, [doneByDay, todoByDay])

  // 往后伸到最远的那个待办 —— 日历不该在今天截断，你欠着的事就在下个月。
  const ahead = useMemo(() => {
    const today = dayKey(new Date())
    const last = [...todoByDay.keys()].filter((d) => d > today).sort().at(-1)
    if (!last) return 0
    return Math.min(120, Math.round((new Date(last + 'T12:00') - new Date(today + 'T12:00')) / 86400000))
  }, [todoByDay])

  const weeks = useMemo(() => weeksOf(counts, span, new Date(), ahead), [counts, span, ahead])
  const marks = useMemo(() => monthMarks(weeks), [weeks])

  // 默认停在今天 —— 日历现在两头都有（左边已办、右边待办），今天是那条界。
  const day = pickedDay || dayKey(new Date())

  if (!data) return <div className="page"><div className="page-inner"><p className="pnone">在翻账…</p></div></div>
  const { summary, reason } = data
  const done = doneByDay.get(day) || []
  const todo = todoByDay.get(day) || []
  const flow = (data.days || []).filter(([, rows]) => rows.some((r) => !isMine(r)))
  const total = [...counts.values()].reduce((a, b) => a + b, 0)

  // 键盘在格子里走：左右一天、上下一周。**焦点跟着选中的那格走**
  // （roving tabindex）——一年 365 个按钮全进 Tab 队列的话，这一页就没法用键盘绕过去了。
  const move = (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (!d) return
    e.preventDefault()
    const all = weeks.flat().filter(Boolean).map((c) => c.day)
    const i = all.indexOf(day)
    const next = all[Math.min(all.length - 1, Math.max(0, i + d))]
    if (next) {
      setPickedDay(next)
      gridRef.current?.querySelector(`[data-day="${next}"]`)?.focus()
    }
  }

  return (
    <div className="page">
      <div className="page-inner lg-inner">
        <header className="page-head">
          <h1>时间线</h1>
          <div className="tabs" role="group" aria-label="看哪一半">
            {[['cal', '日历'], ['flow', '流水']].map(([k, label]) => (
              <button key={k} type="button" className={'tab' + (tab === k ? ' on' : '')}
                      aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          <p className="note">
            {tab === 'cal'
              ? <>你动的手：发出去的信、你记的一笔、办到了的那些（<b>已办</b>），
                  加上还没到点的那些（<b>待办</b>）。今天是中间那条界，右边是还欠着的。</>
              : <>不是你动的手：收到的信、Fairwind 到点干了什么、系统替你开的等待。</>}
            <b>每一行都是从事实现算的</b>，点名字进卡对证。
          </p>
        </header>

        {summary && (
          <p className="lg-week">
            近 7 天：发出 <b>{summary.sent}</b> 封 · 收到 <b>{summary.got}</b> 封
            · 关掉 <b>{summary.closed}</b> 个等待 · 新开 <b>{summary.opened}</b> 个
            {summary.notes > 0 && <> · 记了 <b>{summary.notes}</b> 笔</>}
            {summary.fairwind > 0 && <> · Fairwind 到点动了 <b>{summary.fairwind}</b> 次</>}
          </p>
        )}

        {reason && <p className="pnone">读不出来：{reason}。这不是「什么都没发生」。</p>}

        {tab === 'cal' ? (
          <>
            {/* ── 方格 ──
                窄窗口横着滚（跟 GitHub 一样），不压缩格子：格子一小就分不出深浅，
                那是这张图唯一在说的话。 */}
            <div className="lg-cal">
              <div className="lg-cal-scroll">
                <div className="lg-months">
                  {marks.map((m, i) => <span key={i} className="lg-mon">{m}</span>)}
                </div>
                <div className="lg-grid-wrap">
                  <div className="lg-wd">{WEEKDAY.map((w, i) => <span key={i}>{w}</span>)}</div>
                  <div className="lg-grid" ref={gridRef} role="grid" aria-label="日历">
                    {weeks.map((col, wi) => (
                      <div className="lg-col" key={wi} role="row">
                        {col.map((cell, di) => (cell ? (
                          <button
                            key={cell.day}
                            type="button"
                            role="gridcell"
                            data-day={cell.day}
                            /* 还没到的那几天画成空心：染成实心就等于说「这事办了」 */
                            className={'lg-cell lv' + levelOf(cell.n)
                              + (cell.future ? ' ahead' : '') + (cell.day === day ? ' on' : '')}
                            // 一年 365 格只留一个 Tab 停靠点，其余靠方向键走
                            tabIndex={cell.day === day ? 0 : -1}
                            aria-label={`${md(cell.day)} ${cell.n} 件${cell.future ? '（待办）' : ''}`}
                            aria-selected={cell.day === day}
                            title={`${md(cell.day)} · ${cell.n} 件${cell.future ? '（待办）' : ''}`}
                            onClick={() => setPickedDay(cell.day)}
                            onKeyDown={move}
                          />
                        ) : <span className="lg-cell blank" key={di} aria-hidden="true" />))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="lg-legend">
                <span>{span === 365 ? '这一年' : `这 ${span} 天`}共 {total} 件</span>
                <span className="sp" />
                少
                {[0, 1, 2, 3, 4].map((l) => <i key={l} className={'lg-cell lv' + l} aria-hidden="true" />)}
                多
                <i className="lg-cell lv2 ahead" aria-hidden="true" style={{ marginLeft: 10 }} />
                待办
              </div>
            </div>

            {/* 点哪天看哪天。空的日子也说话——「这天没动静」跟「没查到」不是一回事。 */}
            <section className="lg-day">
              <h2>{md(day)}
                {done.length + todo.length > 0 && <span className="lg-n">{done.length + todo.length} 件</span>}
              </h2>
              {todo.map((r, i) => (
                <div className="lg-row todo" key={'t' + i}>
                  <span className="lg-kind">待办</span>
                  <div className="lg-b">
                    <button className="nname" onClick={() => onOpen({
                      subject_kind: r.subject_kind, subject_id: r.subject_id,
                    })}>{谁(r)}</button>
                    <div className="lg-what">{r.what}</div>
                  </div>
                </div>
              ))}
              {done.map((r, i) => <Row key={day + i} r={r} onOpen={onOpen} />)}
              {!done.length && !todo.length && <p className="pnone">这天没有你办的事，也没有欠着的。</p>}
            </section>

            <p className="nnone">
              看多久：
              {[90, 365].map((d) => (
                <button key={d} className={'lnk' + (span === d ? ' on' : '')}
                        onClick={() => setSpan(d)}> {d === 365 ? '一年' : `${d} 天`}</button>
              ))}
            </p>
          </>
        ) : (
          /* 流水：一条往下排。这一半问的是「刚刚发生了什么」——顺序问题，
             不是形状问题，所以不摆方格。 */
          <>
            {flow.map(([d, rows]) => {
              const mine = rows.filter((r) => !isMine(r))
              return (
                <section key={d} className="lg-day">
                  <h2>{md(d)}<span className="lg-n">{mine.length} 件</span></h2>
                  {mine.map((r, i) => <Row key={d + i} r={r} onOpen={onOpen} />)}
                </section>
              )
            })}
            {!flow.length && <p className="pnone">这 {span === 365 ? '一年' : span + ' 天'}没有收到什么，Fairwind 也没到点动过。</p>}
            <p className="nnone">
              看多久：
              {[90, 365].map((d) => (
                <button key={d} className={'lnk' + (span === d ? ' on' : '')}
                        onClick={() => setSpan(d)}> {d === 365 ? '一年' : `${d} 天`}</button>
              ))}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
