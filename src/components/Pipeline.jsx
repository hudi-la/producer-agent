import React, { useState } from 'react'
import { BALL_LABEL, ballOf, isManual } from '../lib/ball.js'

// 顺序：卡进来先等你批（Fairwind 已在后台读透），批了就一起挑作品/写，
// 然后发出去、等回信；末尾两个收尾去处——成了 = 谈成，停了 = 暂停处理。
const STAGES = [
  ['pending', '待批准'],
  ['matching', '匹配项目'],
  ['writing', '一起写'],
  ['sent', '发出&提交'],
  ['replying', '初次回信&继续沟通'],
  ['won', '谈成'],
  ['paused', '暂停处理'],
]

// 一次造卡任务造出来的卡，够多就折成一叠——首页恒静，想看才展开。
const STACK_MIN = 3

const PAYOFF = { paid: '给钱', access: '给圈子', both: '钱 + 圈子' }

function statusText(p) {
  if (!p.eligible && (p.stage === 'pending' || p.stage === 'matching')) return 'O-1 · 资格搁置'
  switch (p.stage) {
    case 'pending': return '读透了，等你批'
    case 'matching': return '一起挑作品'
    case 'writing': return '一起写中'
    case 'sent': return '已交'
    case 'replying': return '沟通中'
    case 'won': return '谈成 ✓'
    // 为什么停下来（不投 / 资格暂缓 / 你没兴趣）是卡上的事，列不再分。
    case 'paused': return '暂停处理'
    default: return ''
  }
}

// 主动外联没有截止逼你，唯一的引擎是「这条该碰了」。
function touch(p) {
  if (!p.next_touch_at) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const at = new Date(p.next_touch_at + 'T00:00:00')
  const days = Math.round((at - today) / 86400000)
  if (days <= 0) return { text: '该跟进了', due: true }
  if (days === 1) return { text: '明天跟进', due: false }
  return { text: days + ' 天后跟进', due: false }
}

function PCard({ p, onOpen, onDragStart, unseen }) {
  const dim = p.stage === 'paused' || !p.eligible
  const opencall = p.kind && p.kind !== 'workshop' // 投申请的正式机会（区别于 workshop 冷外联）
  const t = touch(p)
  const ball = ballOf(p)
  return (
    <button
      className={'pcard' + (opencall ? ' opencall' : '')}
      style={dim ? { opacity: 0.58 } : undefined}
      draggable
      onDragStart={(e) => onDragStart(e, p)}
      onClick={() => onOpen(p)}
    >
      {unseen && <span className="pc-badge" aria-label="Fairwind 回复了" />}
      {/* 球在谁那边——stage 说的是走到哪一格，这个说的是现在该谁动。 */}
      {ball && (
        <div className={'pc-ball ' + ball + (isManual(p) ? ' pinned' : '')}>
          <span className="bd" aria-hidden="true" />{BALL_LABEL[ball]}
        </div>
      )}
      <div className="pc-t">{p.title}</div>
      {p.match_stars ? <div className="pc-stars">{'★'.repeat(p.match_stars)}</div> : null}
      {/* 截止和跟进是两回事，可以同时挂着（CultureHub：合同等对方回，但营销素材 8/11 到期、球在你这边）。
          两个都有就都显示——只显示一个会藏掉真正该做的那件事。 */}
      {p.deadline && <div className="pc-ddl">截止 {p.deadline}</div>}
      {t && <div className={'pc-ddl' + (t.due ? ' due' : '')}>{t.text}</div>}
      {!p.deadline && !t && <div className="pc-ddl none">无固定截止</div>}
      {p.payoff && <div className="pc-payoff">{PAYOFF[p.payoff]}</div>}
      {p.work_title && <div className="pc-p">{p.work_title}</div>}
      <div className="pc-m" style={p.stage === 'won' ? { color: 'var(--good)' } : undefined}>
        <span className={'src' + (p.source === 'manual' ? '' : ' scout')} aria-hidden="true" />
        {p.contact_name ? p.contact_name + ' · ' : ''}{statusText(p)}
      </div>
    </button>
  )
}

// 一叠：同一个造卡任务造出来的一批，默认折着，只递一件事——「这儿有一叠，22 张」。
function Stack({ name, items, open, onToggle, onOpen, onDragStart, unseen }) {
  // 折着的时候只报一个数：这一叠里有几张在等你动。比「几张该跟进」更接近你要问的那句话。
  const mine = items.filter((p) => ballOf(p) === 'me').length
  const anyUnseen = items.some((p) => unseen?.has(p.id))
  return (
    <div className={'stack' + (open ? ' open' : '')}>
      <button className="stack-head" onClick={onToggle}>
        <span className="stack-pile" aria-hidden="true" />
        {anyUnseen && !open && <span className="pc-badge" aria-label="Fairwind 回复了" />}
        <span className="stack-txt">
          <span className="stack-n">{name || '一批机构'}</span>
          <span className="stack-c">
            {items.length} 张{mine ? ` · ${mine} 张待处理` : ''}
          </span>
        </span>
        <span className="stack-chev" aria-hidden="true">{open ? '收起' : '展开'}</span>
      </button>
      {open && items.map((p) => (
        <PCard p={p} key={p.id} onOpen={onOpen} onDragStart={onDragStart} unseen={unseen?.has(p.id)} />
      ))}
    </div>
  )
}

export default function Pipeline({ pursuits, tasks = [], onOpen, onMove, unseen = new Set() }) {
  const [over, setOver] = useState(null)
  const [openStacks, setOpenStacks] = useState(() => new Set())

  const taskName = (id) => tasks.find((t) => t.id === id)?.name

  const toggleStack = (id) =>
    setOpenStacks((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const onDragStart = (e, p) => {
    e.dataTransfer.setData('text/plain', p.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDrop = (e, stage) => {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData('text/plain')
    if (id) onMove?.(id, stage)
  }

  // 一列里：够数的同任务卡折成一叠，其余照旧单张铺开。保持原有顺序。
  const layout = (items) => {
    const counts = {}
    for (const p of items) if (p.task_id) counts[p.task_id] = (counts[p.task_id] || 0) + 1
    const out = []
    const seen = new Set()
    for (const p of items) {
      const tid = p.task_id
      if (tid && counts[tid] >= STACK_MIN) {
        if (seen.has(tid)) continue
        seen.add(tid)
        out.push({ stack: tid, items: items.filter((x) => x.task_id === tid) })
      } else {
        out.push({ card: p })
      }
    }
    return out
  }

  return (
    <div className="board">
      {STAGES.map(([key, label]) => {
        const items = pursuits.filter((p) => p.stage === key)
        return (
          <div
            className={'col' + (key === 'pending' ? ' now' : '') + (over === key ? ' drop' : '')}
            key={key}
            onDragOver={(e) => { e.preventDefault(); setOver(key) }}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(null) }}
            onDrop={(e) => onDrop(e, key)}
          >
            <div className="col-h"><span className="cn">{label}</span><span className="cc">{items.length}</span></div>
            {layout(items).map((row) =>
              row.stack ? (
                <Stack
                  key={row.stack}
                  name={taskName(row.stack)}
                  items={row.items}
                  open={openStacks.has(row.stack)}
                  onToggle={() => toggleStack(row.stack)}
                  onOpen={onOpen}
                  onDragStart={onDragStart}
                  unseen={unseen}
                />
              ) : (
                <PCard p={row.card} key={row.card.id} onOpen={onOpen} onDragStart={onDragStart} unseen={unseen.has(row.card.id)} />
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
