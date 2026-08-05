import React, { useState } from 'react'
import { KINDS, subInfo, CREDIT_ORDER, CREDIT_LABEL } from '../data/entriesSeed.js'

const CONCERN_ORDER = ['intimacy', 'systems', 'body_space_time']
const BOX_LABELS = { why_now: '为什么是现在', reach_out: '想触达', hidden_links: '隐线', materials: '材料', note: '备注' }

const boxEntries = (box) => Object.entries(box || {}).filter(([, v]) => v != null && v !== '')

function Entry({ e }) {
  const [open, setOpen] = useState(false)
  const entries = boxEntries(e.box)
  const facts = subInfo(e)
  const imgs = e.images || []
  return (
    <div className="work">
      <button className="work-hd" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {imgs.length > 0 && <img className="w-thumb" src={imgs[0]} alt="" loading="lazy" />}
        <div className="work-main">
          <div className="w-t">{e.title}</div>
          {e.body && <div className="w-d">{e.body}</div>}
          <div className="w-foot">
            <span className={'boxchip' + (entries.length ? ' filled' : '')}>
              {entries.length ? `盒子 · 已补 ${entries.length} 条` : '盒子 · 空'}
            </span>
            {facts.map((f, i) => <span className="w-medium" key={i}>{f}</span>)}
            {e.source === 'website' && <span className="src-tag">读自网站</span>}
          </div>
        </div>
        <span className={'chev' + (open ? ' open' : '')} aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="box">
          {imgs.length > 1 && (
            <div className="w-imgs">{imgs.map((src, i) => <img src={src} alt="" key={i} loading="lazy" />)}</div>
          )}
          <div className="bx-h">盒子 · 网站装不下的</div>
          {entries.length === 0 && <div className="bx-empty">还没补东西。为什么是现在 / 想触达谁 / 隐线 / 高清图、旧申请稿……都往这丢。</div>}
          {entries.map(([k, v]) => (
            <div className="field" key={k}><span className="k">{BOX_LABELS[k] || k} · </span><span className="v">{String(v)}</span></div>
          ))}
          <div className="add">+ 补一条 / 丢进材料</div>
        </div>
      )}
    </div>
  )
}

// Build ordered [subLabel, items[]] groups for a sub-grouped section.
function subGroups(items, sub, concerns) {
  const keyOf = sub === 'concern' ? (e) => e.concern : (e) => e.meta?.type
  const order = sub === 'concern' ? CONCERN_ORDER : CREDIT_ORDER
  const labelOf = sub === 'concern'
    ? (k) => concerns?.[k] || k
    : (k) => CREDIT_LABEL[k] || k
  const groups = []
  const seen = new Set()
  for (const k of order) {
    const g = items.filter((e) => keyOf(e) === k)
    if (g.length) { groups.push([labelOf(k), g]); seen.add(k) }
  }
  for (const e of items) {
    const k = keyOf(e)
    if (!seen.has(k)) { seen.add(k); groups.push([labelOf(k), items.filter((x) => keyOf(x) === k)]) }
  }
  return groups
}

function KindSection({ label, items, sub, concerns }) {
  return (
    <section className="kind">
      <div className="kind-h">{label} · {items.length}</div>
      {sub ? (
        subGroups(items, sub, concerns).map(([subLabel, g]) => (
          <div className="concern" key={subLabel}>
            <div className="cn-h">{subLabel}</div>
            <div className="works">{g.map((e) => <Entry e={e} key={e.id || e.title + e.sort} />)}</div>
          </div>
        ))
      ) : (
        <div className="works">{items.map((e) => <Entry e={e} key={e.id || e.title + e.sort} />)}</div>
      )}
    </section>
  )
}

export default function LibraryDrawer({ entries, concerns, open, onClose }) {
  const byKind = new Map()
  for (const e of entries) {
    if (!byKind.has(e.kind)) byKind.set(e.kind, [])
    byKind.get(e.kind).push(e)
  }
  const ordered = []
  const seen = new Set()
  for (const k of KINDS) {
    const items = byKind.get(k.key)
    if (items && items.length) { ordered.push({ ...k, items }); seen.add(k.key) }
  }
  for (const [kind, items] of byKind) {
    if (!seen.has(kind)) ordered.push({ key: kind, label: kind, items })
  }

  return (
    <>
      <div className={'ov-scrim' + (open ? ' on' : '')} onClick={onClose} aria-hidden="true" />
      <aside className={'drawer' + (open ? ' open' : '')} aria-label="战绩信息库" aria-hidden={!open}>
        <div className="drawer-head">
          <div className="dh-top"><h3>战绩信息库</h3><button className="btn" onClick={onClose}>收起</button></div>
          <p className="note">渡懂你的一切，都收在这里 · {entries.length} 条。作品读自 <b>hudiworks.com</b>；工作、教育、战绩、自述一条条补进来。每条下面的<span className="bx">盒子</span>，放"网站装不下"的私密外联层。</p>
        </div>
        <div className="drawer-body">
          {ordered.map((k) => (
            <KindSection key={k.key} label={k.label} items={k.items} sub={k.sub} concerns={concerns} />
          ))}
        </div>
      </aside>
    </>
  )
}
