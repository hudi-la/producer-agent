import { useDialogFocus } from '../lib/useDialogFocus.js'
import ErrorNotice from './ErrorNotice.jsx'
import React, { useEffect, useMemo, useState } from 'react'
import {
  LANES, STATUS_LABEL, REACH_LABEL,
  laneOf, sortPool, counts, latestRound, whenText, checkedText, staleOpen,
  pickOpportunity, dropOpportunity, undropOpportunity,
} from '../lib/opportunities.js'
import { onPulse } from '../lib/pulse.js'
import Veil from './Veil.jsx'
import { t } from '../i18n/index.js'

// 机会池：他那张 Excel 在 Fairwind 里的样子。
//
// **是一张表，不是一列卡。** 他的原话（2026-09-03）：「像那个 Excel 一样，就是一个表，
// 不要放太多卡在那里。」82 行进看板会把界面撑爆，而这些行大多数根本没有往来可判。
//
// 三件这张表必须做到的事：
//   · 开着的、还没捡的排最前 —— 那是这一周唯一需要他看的东西
//   · 已经捡过的、划掉的**沉底但不消失** —— 消失了他会以为丢了
//   · 「没查过」和「查过没变」要分得开；「往届名单没查到」和「多半白投」也要分得开
//
// 设计稿：docs/specs/2026-09-03-opportunity-pool-design.md 第七节

function Stars({ n }) {
  if (!n) return <span className="op-dim">—</span>
  return <span className="op-stars">{'★'.repeat(n)}</span>
}

/** 够得着那一格。凭证（往届名单里查到了谁）挂在 title 上，鼠标停上去看得到。 */
function Reach({ o }) {
  if (!o.reach) return <span className="op-dim">{t('还没判')}</span>
  const tip = [o.reach_why, o.reach_evidence && t('凭证：{x}', { x: o.reach_evidence })]
    .filter(Boolean).join('\n')
  return (
    <span className={'op-reach r-' + o.reach} title={tip || undefined}>
      {REACH_LABEL[o.reach]}
      {o.reach_evidence && <i className="op-ev" aria-hidden="true">·</i>}
    </span>
  )
}

function Row({ o, busy, onPick, onDrop, onUndrop }) {
  const lane = laneOf(o)
  const stale = staleOpen(o)
  return (
    <tr className={'op-row lane-' + lane}>
      <td className="op-c-st">
        {/* 标着开着、截止日却过了 = 旧状态没复查过。绿点 + 一个过期的日子是在撒谎。 */}
        <span className={'op-dot s-' + (stale ? 'unknown' : (o.status || 'unknown'))} aria-hidden="true" />
        {stale ? t('待复查') : (STATUS_LABEL[o.status] || t('没查过'))}
      </td>
      <td className="op-c-t">
        {o.url
          ? <a className="op-title" href={o.url} target="_blank" rel="noreferrer">{o.title}</a>
          : <span className="op-title">{o.title}</span>}
        {o.org && <span className="op-org"><Veil>{o.org}</Veil></span>}
        {!o.eligible && <span className="op-hold">{t('资格搁置')}</span>}
        {o.why && <div className="op-why">{o.why}</div>}
      </td>
      <td className="op-c-k">{o.kind || <span className="op-dim">—</span>}</td>
      <td className="op-c-f"><Stars n={o.fit_stars} /></td>
      <td className="op-c-r"><Reach o={o} /></td>
      <td className={'op-c-w' + (stale ? ' past' : '')}>{whenText(o) || <span className="op-dim">—</span>}</td>
      <td className="op-c-ck">{checkedText(o)}</td>
      <td className="op-c-a">
        {lane === 'onboard' ? (
          <span className="op-dim">{t('已在看板上')}{o.pursuit_stage ? ` · ${o.pursuit_stage}` : ''}</span>
        ) : lane === 'dropped' ? (
          <button className="op-btn ghost" disabled={busy} onClick={() => onUndrop(o)}>{t('划回来')}</button>
        ) : (
          <>
            <button className="op-btn" disabled={busy} onClick={() => onPick(o)}>{t('捡出来')}</button>
            <button className="op-btn ghost" disabled={busy} onClick={() => onDrop(o)}>{t('别再提')}</button>
          </>
        )}
      </td>
    </tr>
  )
}

export default function Opportunities({ open, onClose, pool, onChanged, lastRun }) {
  const [lane, setLane] = useState('open')
  const dialogRef = useDialogFocus(open, onClose)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  // 开着的时候跟着 pool 那一列脉搏走：脑子跑完一轮，这张表自己变。
  useEffect(() => {
    if (!open || !onChanged) return
    return onPulse('pool', () => onChanged())
  }, [open, onChanged])

  const rows = pool?.rows || []
  const c = useMemo(() => counts(rows), [rows])
  const round = useMemo(() => latestRound(rows), [rows])

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return sortPool(rows.filter((o) => {
      if (lane !== 'all' && laneOf(o) !== lane) return false
      if (!kw) return true
      return [o.title, o.org, o.kind, o.location, o.why].some((x) => String(x || '').toLowerCase().includes(kw))
    }))
  }, [rows, lane, q])

  const act = async (fn, o) => {
    setBusy(o.id); setErr(null)
    try { await fn(o.id); await onChanged?.() } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  return (
    <>
      <div className={'ov-scrim' + (open ? ' on' : '')} onClick={onClose} aria-hidden="true" />
      <div className={'opmodal' + (open ? ' open' : '')} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('机会池')} aria-hidden={!open} inert={!open ? "" : undefined}>
        <div className="tm-head">
          <h3>{t('机会池 · {n} 行', { n: c.all })}</h3>
          <button className="btn" onClick={onClose}>{t('收起')}</button>
        </div>

        {/* 这一轮发生了什么。战报的第一行就够了，全文在造卡任务面板里。 */}
        <p className="op-round">
          {round ? t('最近一轮 {round}：表里 {open} 个开着、{watching} 个还关着、{onboard} 个已经在看板上。', { round, open: c.open, watching: c.watching, onboard: c.onboard }) :
            t('表里 {open} 个开着、{watching} 个还关着、{onboard} 个已经在看板上。', { open: c.open, watching: c.watching, onboard: c.onboard })}
          {lastRun ? ` ${lastRun}` : ''}
        </p>

        <div className="op-bar">
          <div className="tabs" role="group" aria-label={t('看哪些')}>
            {[['all', t('全部')], ...LANES].map(([k, label]) => (
              <button
                key={k} type="button"
                className={'tab' + (lane === k ? ' on' : '')}
                aria-pressed={lane === k}
                onClick={() => setLane(k)}
              >
                {label}{k === 'all' ? ` ${c.all}` : c[k] ? ` ${c[k]}` : ''}
              </button>
            ))}
          </div>
          <span className="sp" />
          <input
            className="op-q" value={q} placeholder={t('搜名字 / 机构 / 类型…')}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {err && <ErrorNotice error={err} context={t('保存更改')} />}

        <div className="op-wrap">
          <table className="op-table">
            <thead>
              <tr>
                <th>{t('状态')}</th><th>{t('机会')}</th><th>{t('类型')}</th><th>{t('匹配')}</th><th>{t('够得着')}</th><th>{t('时间')}</th><th>{t('上次查')}</th><th />
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <Row
                  key={o.id} o={o} busy={busy === o.id}
                  onPick={(x) => act(pickOpportunity, x)}
                  onDrop={(x) => act(dropOpportunity, x)}
                  onUndrop={(x) => act(undropOpportunity, x)}
                />
              ))}
            </tbody>
          </table>
          {/* 筛得一行不剩要说话。空白会被当成「坏了」。 */}
          {!shown.length && (
            <div className="op-empty">
              {q ? t('没有匹配「{q}」的行。', { q }) : lane === 'open' ? t('这一格现在没有开着的机会。下一轮复查会更新。') : t('这一格是空的。')}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
