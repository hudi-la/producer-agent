import { useEffect, useState } from 'react'
import { loadLedger, KIND_LABEL } from '../lib/ledger.js'
import { md } from '../lib/when.js'

// 「流水」—— 办完的事有自己的一页。
//
// 这一页存在的理由（2026-08-20 他拍的）：系统自己比对出「这事办到了」
// 的时候，他想要一点心安 —— 但不要提醒（攒多了就是另一个「判为不用回」）。
// 所以是 pull 不是 push：每一行都能点进卡里对证，每一行都是现算的，
// 永远不会跟事实分叉。
//
// 「关掉一个等待」那一行就是他要的那句「它自己发现办到了」——
// why 里写着凭什么（对方回了 / 你办了 / 比对到你的发送）。

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

export default function Ledger({ onOpen }) {
  const [data, setData] = useState(null)
  const [span, setSpan] = useState(14)
  useEffect(() => { loadLedger(span).then(setData) }, [span])

  if (!data) return <div className="page"><div className="page-inner"><p className="pnone">在翻账…</p></div></div>
  const { days, summary, reason } = data

  return (
    <div className="page">
      <div className="page-inner">
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

        {days.map(([day, rows]) => (
          <section key={day} className="lg-day">
            <h2>{md(day)}</h2>
            {rows.map((r, i) => <Row key={day + i} r={r} onOpen={onOpen} />)}
          </section>
        ))}

        {!reason && !days.length && (
          <p className="pnone">这 {span} 天账上没有动静。</p>
        )}

        <p className="nnone">
          看更久：
          {[14, 30, 90].map((d) => (
            <button key={d} className={'lnk' + (span === d ? ' on' : '')}
                    onClick={() => setSpan(d)}> {d} 天</button>
          ))}
        </p>
      </div>
    </div>
  )
}
