import { useEffect, useMemo, useRef, useState } from 'react'
import { loadLedger, KIND_LABEL } from '../lib/ledger.js'
import { md } from '../lib/when.js'
import { weeksOf, monthMarks, levelOf, dayKey } from '../lib/heat.js'

// 「流水」—— 办完的事有自己的一页。
//
// 这一页存在的理由（2026-08-20 他拍的）：系统自己比对出「这事办到了」
// 的时候，他想要一点心安 —— 但不要提醒（攒多了就是另一个「判为不用回」）。
// 所以是 pull 不是 push：每一行都能点进卡里对证，每一行都是现算的，
// 永远不会跟事实分叉。
//
// 排法换成了日历（2026-08-22 他拍的）：原来一天一段往下排，
// 想知道「上个月有没有停过」得滚三屏。流水回答的是**形状**问题
// ——这阵子动没动、哪几周连着、哪几天断了——铺成方格一眼就有。
// 格子只递形状，那一天具体发生了什么在下面那一段里，点哪天看哪天。

function Row({ r, onOpen }) {
  return (
    <div className={'lg-row ' + r.kind}>
      <span className="lg-kind">{KIND_LABEL[r.kind] || r.kind}</span>
      <div className="lg-b">
        <button className="nname" onClick={() => onOpen(r)}>{r.subject_name || '（没名字）'}</button>
        <div className="lg-what">{r.what}</div>
        {r.why && r.kind === 'wait_close' && <div className="lg-why">凭什么算办到：{r.why}</div>}
      </div>
      <span className="lg-at">{new Date(r.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  )
}

const WEEKDAY = ['一', '', '三', '', '五', '', '']   // 跟 GitHub 一样隔行标，七行都标太吵

export default function Ledger({ onOpen }) {
  const [data, setData] = useState(null)
  const [span, setSpan] = useState(365)
  const [pickedDay, setPickedDay] = useState(null)
  const gridRef = useRef(null)
  useEffect(() => { loadLedger(span).then(setData) }, [span])

  const byDay = useMemo(() => new Map(data?.days || []), [data])
  const counts = useMemo(
    () => new Map([...byDay].map(([d, rows]) => [d, rows.length])), [byDay])
  const weeks = useMemo(() => weeksOf(counts, span), [counts, span])
  const marks = useMemo(() => monthMarks(weeks), [weeks])

  // 默认停在最近一个有动静的日子 —— 打开这一页最想看的就是「上次动的是什么」。
  // 全空的时候停在今天：空也得有个格子亮着，不然键盘无处落脚。
  const 最近有动静的 = useMemo(() => {
    const ds = [...counts.keys()].filter((d) => counts.get(d) > 0).sort()
    return ds.at(-1) || dayKey(new Date())
  }, [counts])
  const day = pickedDay && byDay.has(pickedDay) ? pickedDay : (pickedDay || 最近有动静的)

  if (!data) return <div className="page"><div className="page-inner"><p className="pnone">在翻账…</p></div></div>
  const { summary, reason } = data
  const rows = byDay.get(day) || []
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
          <h1>流水</h1>
          <p className="note">
            办完的事都在这儿——发了什么、收了什么、哪些等待被关掉了、Fairwind
            到点干了什么。<b>每一行都是从事实现算的</b>，点名字进卡对证。
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
              <div className="lg-grid" ref={gridRef} role="grid" aria-label="流水日历">
                {weeks.map((col, wi) => (
                  <div className="lg-col" key={wi} role="row">
                    {col.map((cell, di) => (cell ? (
                      <button
                        key={cell.day}
                        type="button"
                        role="gridcell"
                        data-day={cell.day}
                        className={'lg-cell lv' + levelOf(cell.n) + (cell.day === day ? ' on' : '')}
                        // 一年 365 格只留一个 Tab 停靠点，其余靠方向键走
                        tabIndex={cell.day === day ? 0 : -1}
                        aria-label={`${md(cell.day)} ${cell.n} 件`}
                        aria-selected={cell.day === day}
                        title={`${md(cell.day)} · ${cell.n} 件`}
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
          </div>
        </div>

        {/* 点哪天看哪天。空的日子也说话——「这天没动静」跟「没查到」不是一回事。 */}
        <section className="lg-day">
          <h2>{md(day)}{rows.length > 0 && <span className="lg-n">{rows.length} 件</span>}</h2>
          {rows.length
            ? rows.map((r, i) => <Row key={day + i} r={r} onOpen={onOpen} />)
            : <p className="pnone">这天账上没有动静。</p>}
        </section>

        <p className="nnone">
          看多久：
          {[90, 365].map((d) => (
            <button key={d} className={'lnk' + (span === d ? ' on' : '')}
                    onClick={() => setSpan(d)}> {d === 365 ? '一年' : `${d} 天`}</button>
          ))}
        </p>
      </div>
    </div>
  )
}
