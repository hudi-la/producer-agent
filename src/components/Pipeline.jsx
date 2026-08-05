import React, { useEffect, useState } from 'react'
import { BALL_LABEL, ballOf } from '../lib/ball.js'
import { deadlineLine, actionLine } from '../lib/nextAction.js'

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

// 「钱还是圈子」不在卡上了——它是决定要不要推的依据，不是每天扫看板要看的东西。
// 移到了详情页的事实区（PursuitFocus 的 Facts）。

// 随手记的几个字。就地写，不用点进卡里——「记一笔」这件事一旦要跳页就不会发生。
function Jot({ p, onSave }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(p.jot || '')

  // 别人改了这张卡（Fairwind 后台、或另一个标签页），没在编辑就跟着更新
  useEffect(() => { if (!editing) setText(p.jot || '') }, [p.jot, editing])

  const commit = () => {
    setEditing(false)
    const t = text.trim()
    if (t !== (p.jot || '')) onSave?.(p, t)
  }

  const stop = (e) => e.stopPropagation()   // 卡整体可点，这一小块不能连带触发

  if (editing) {
    return (
      <textarea
        className="pc-jot-in"
        value={text}
        autoFocus
        rows={2}
        placeholder="记几个字……"
        onClick={stop}
        onMouseDown={stop}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          // Enter 存，Shift+Enter 换行，Esc 放弃这次修改
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); commit() }
          if (e.key === 'Escape') { setText(p.jot || ''); setEditing(false) }
        }}
      />
    )
  }

  return (
    <button
      className={'pc-jot' + (p.jot ? ' has' : '')}
      onClick={(e) => { stop(e); setEditing(true) }}
      onMouseDown={stop}
      title={p.jot ? '点一下改' : '记几个字'}
    >
      {p.jot || '＋ 记一笔'}
    </button>
  )
}

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

function PCard({ p, onOpen, onDragStart, onTick, onJot, unseen }) {
  const dim = p.stage === 'paused' || !p.eligible
  const opencall = p.kind && p.kind !== 'workshop' // 投申请的正式机会（区别于 workshop 冷外联）
  const ball = ballOf(p)
  const ddl = deadlineLine(p)
  const act = actionLine(p)

  // 卡整体是个可点的东西，但里面还嵌了个勾选框——button 套 button 是非法的，
  // 所以外层用 div + role，键盘操作自己接。
  const open = () => onOpen(p)
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
  }

  return (
    <div
      className={'pcard' + (opencall ? ' opencall' : '')}
      style={dim ? { opacity: 0.58 } : undefined}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => onDragStart(e, p)}
      onClick={open}
      onKeyDown={onKey}
    >
      {unseen && <span className="pc-badge" aria-label="Fairwind 回复了" />}
      {/* 球在谁那边——stage 说的是走到哪一格，这个说的是现在该谁动。 */}
      {ball && (
        <div className={'pc-ball ' + ball}>
          <span className="bd" aria-hidden="true" />{BALL_LABEL[ball]}
        </div>
      )}
      <div className="pc-t">{p.title}</div>
      {p.match_stars ? <div className="pc-stars">{'★'.repeat(p.match_stars)}</div> : null}

      {/* 该干什么——一张卡只说一句，而且每句都有确切依据。能勾的就勾掉。 */}
      {act && (
        act.tick ? (
          <button
            className={'pc-act tickable' + (act.urgent ? ' urgent' : '')}
            onClick={(e) => { e.stopPropagation(); onTick?.(p, act.tick) }}
            title="做完了？勾掉"
          >
            <span className="tick" aria-hidden="true" />
            <span className="pc-act-t">{act.text}</span>
          </button>
        ) : (
          <div className={'pc-act' + (act.urgent ? ' urgent' : '')}>{act.text}</div>
        )
      )}

      {ddl ? (
        <div className={'pc-ddl' + (ddl.urgent ? ' due' : '')}>{ddl.text}</div>
      ) : (
        <div className="pc-ddl none">无固定截止</div>
      )}
      {p.work_title && <div className="pc-p">{p.work_title}</div>}
      <Jot p={p} onSave={onJot} />
      <div className="pc-m" style={p.stage === 'won' ? { color: 'var(--good)' } : undefined}>
        <span className={'src' + (p.source === 'manual' ? '' : ' scout')} aria-hidden="true" />
        {p.contact_name ? p.contact_name + ' · ' : ''}{statusText(p)}
      </div>
    </div>
  )
}

// 一叠：同一个造卡任务造出来的一批，默认折着，只递一件事——「这儿有一叠，22 张」。
function Stack({ name, items, open, onToggle, onOpen, onDragStart, onTick, onJot, unseen }) {
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
        <PCard p={p} key={p.id} onOpen={onOpen} onDragStart={onDragStart} onTick={onTick} onJot={onJot} unseen={unseen?.has(p.id)} />
      ))}
    </div>
  )
}

export default function Pipeline({ pursuits, tasks = [], onOpen, onMove, onTick, onJot, unseen = new Set() }) {
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
                  onTick={onTick}
                  onJot={onJot}
                  unseen={unseen}
                />
              ) : (
                <PCard p={row.card} key={row.card.id} onOpen={onOpen} onDragStart={onDragStart} onTick={onTick} onJot={onJot} unseen={unseen.has(row.card.id)} />
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
