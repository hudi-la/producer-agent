import { key as qKey } from '../lib/queue.js'
import React, { useEffect, useMemo, useState } from 'react'
import { BALL_LABEL, ballOf } from '../lib/ball.js'
import { deadlineLine, openLine } from '../lib/nextAction.js'
import { goldLine } from '../lib/stateText.js'
import { heldLabel, useProfile } from '../lib/profile.js'
import { tintSlots, slotOf, inBatch } from '../lib/batchTint.js'
import Veil from './Veil.jsx'
// 「新」= 从来没点开过（seen_at 是 null）。不是新状态，是 pursuit_seen 早就有的事实。
import { isFresh } from '../lib/tasks.js'

// 顺序：卡进来先等你批（Fairwind 已在后台读透），批了就一起挑作品/写，
// 然后发出去、等回信；末尾两个收尾去处——成了 = 谈成，停了 = 暂停处理。
const STAGES = [
  ['pending', '新机会'],
  ['matching', '匹配项目'],
  ['writing', '一起写'],
  ['sent', '发出&提交'],
  ['replying', '进一步'],
  ['won', '谈成'],
  ['paused', '暂停处理'],
  // 可能以后有用的，放最后。放进来的卡之后再定行为（2026-08-20）——
  // 现在它不静音（信照归、state 照算），也不算「该有动静的」（不吊灰气泡）。
  ['watch', '持续关注'],
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

function statusText(p, held) {
  if (!p.eligible && (p.stage === 'pending' || p.stage === 'matching')) return held
  switch (p.stage) {
    case 'pending': return '读透了，等你批'
    case 'matching': return '一起挑作品'
    case 'writing': return '一起写中'
    case 'sent': return '已交'
    case 'replying': return '沟通中'
    case 'won': return '谈成 ✓'
    // 为什么停下来（不投 / 资格暂缓 / 你没兴趣）是卡上的事，列不再分。
    case 'paused': return '暂停处理'
    case 'watch': return '持续关注'
    default: return ''
  }
}

// 发出&提交 / 进一步 / 谈成 —— 这三列的卡**应该**在等着什么。
// 气泡视图里它们要是什么都没等，就吊一个灰气泡出来：那是「判漏了」
// 最可能藏身的地方（一封信被错判成不用回，线就这么安静了）。
const 该有动静的 = new Set(['sent', 'replying', 'won'])

function PCard({ p, st, audit, tints, onOpen, onDragStart, onJot, unseen, picking, checked, onPick, onDesk = false }) {
  const held = heldLabel(useProfile())
  const dim = p.stage === 'paused' || !p.eligible
  // 这张是哪一摊撒出去的 —— 决定底色偏哪一点。只有冷外联那几摊有，见 lib/batchTint.js
  const tint = slotOf(p, tints)
  const ball = ballOf(p)
  // 截止日期是「投递窗口」的事实 —— 线走到发出&提交之后它的任务就完成了，
  // 封面上留着只会跟真正活着的状态行（金色那行「在等什么」）抢注意力。
  // 真例：Stanford 已交，封面还喊着「截止 8/18」；CultureHub 谈成了，
  // 还挂着「截止 8/11 · 营销素材」。日期不丢 —— 左栏「事实」里一直有。
  // 还没投的照旧显示，过了截止还没投的更要红着喊 —— 那才是截止的用处。
  const 投过了 = 该有动静的.has(p.stage)
  const ddl = 投过了 ? null : deadlineLine(p)
  const opn = 投过了 ? null : openLine(p)

  // 卡整体是个可点的东西，但里面还嵌了个勾选框——button 套 button 是非法的，
  // 所以外层用 div + role，键盘操作自己接。
  //
  // 批量操作开着的时候，整张卡改成「勾/取消勾」——不在卡上另开一个小热区，
  // 那种一按就按歪。角上那个方块只是给你看的，不单独接点击。
  const open = () => (picking ? onPick([qKey('pursuit', p.id)], !checked) : onOpen(p))
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
  }

  return (
    <div
      className={'pcard' + (tint === null ? '' : ' k-t' + tint) + (picking ? ' pickable' : '') + (checked ? ' on' : '')}
      style={dim ? { opacity: 0.58 } : undefined}
      role={picking ? 'checkbox' : 'button'}
      aria-checked={picking ? checked : undefined}
      tabIndex={0}
      draggable={!picking}
      onDragStart={(e) => onDragStart(e, p)}
      onClick={open}
      onKeyDown={onKey}
    >
      {/* 气泡审计视图：状态吊在卡头顶上，一眼扫全板。
          有状态 → 金（等待）/ 红（到点）；该有动静却没有 → 灰气泡点名。 */}
      {audit && (st || 该有动静的.has(p.stage)) && (
        <div className={'pc-bubble' + (!st ? ' quiet' : st.zone === 'due' ? ' due' : '')}>
          {st ? goldLine(st) : '静了 —— 没在等任何东西'}
        </div>
      )}
      {picking && <span className="pc-check" aria-hidden="true" />}
      {unseen && <span className="pc-badge" aria-label="Fairwind 回复了" />}
      {/* 卡角上的记号：这张今天挑了。跟顶栏数字、抽屉那颗开关一起翻面——
          关了抽屉回到看板，一眼看得出挑了哪几张、还没挑哪几张。 */}
      {onDesk && <span className="pc-desk" aria-label="已展开">已展开</span>}
      {/* 你自己点的标签。系统不动它——点亮了就一直亮着，直到你再点。 */}
      {ball && (
        <div className={'pc-ball ' + ball}>
          <span className="bd" aria-hidden="true" />{BALL_LABEL[ball]}
        </div>
      )}
      {/* 从来没点开过的卡挂个「新」。点开 → markSeen → 灭，跟红点同一个机制。
          scout 每周撒进来的那几张就靠它认：你还没看过的一眼能挑出来。 */}
      <div className="pc-t">{isFresh(p) && <span className="pc-fresh" aria-label="还没点开过">新</span>}{p.title}</div>
      {p.match_stars ? <div className="pc-stars">{'★'.repeat(p.match_stars)}</div> : null}

      {/* 「该干什么」那一行删了（见 lib/nextAction.js 顶部）。
          系统不再替你判「这事该动了」——你觉得该动，点亮上面那个标签。 */}

      {ddl ? (
        <div className={'pc-ddl' + (ddl.urgent ? ' due' : '')}>{ddl.text}</div>
      ) : !投过了 && (
        <div className="pc-ddl none">无固定截止</div>
      )}
      {/* 开放日期也是确定的信息，有就显示。不替你判急不急。 */}
      {opn && <div className="pc-ddl">{opn.text}</div>}
      {/* 这条线现在卡在什么上 —— 系统从往来算出来的（v_pa_state），
          跟截止时间一样是金色的。它跟球权并排、不互相覆盖：球权是你随手
          记的便签，系统不读它。两个不一致，就让你看见不一致。 */}
      {st && <div className={'pc-wait' + (st.zone === 'due' ? ' due' : '')}>{goldLine(st)}</div>}
      {p.work_title && <div className="pc-p">{p.work_title}</div>}
      <Jot p={p} onSave={onJot} />
      <div className="pc-m" style={p.stage === 'won' ? { color: 'var(--good)' } : undefined}>
        <span className={'src' + (p.source === 'manual' ? '' : ' scout')} aria-hidden="true" />
        {p.contact_name ? <><Veil>{p.contact_name}</Veil>{' · '}</> : ''}
        {/* **有外部新来信就说这句，顶掉阶段。**
            卡面上的位置很贵：这条线有信在等你的时候，「新来信」比「沟通中」要紧。
            点开这张卡就灭（跟右上角红点同一个机制），退回显示阶段。 */}
        {p.new_mail
          ? <span className="pc-new">新来信</span>
          : statusText(p, held)}
      </div>
    </div>
  )
}

// 一叠：同一个造卡任务造出来的一批，默认折着，只递一件事——「这儿有一叠，22 张」。
function Stack({ name, items, open, onToggle, onOpen, onDragStart, onJot, unseen, picking, picked, onPick, states, audit, tints, desk }) {
  // 折着的时候只报一个数：这一叠里有几张在等你动。比「几张该跟进」更接近你要问的那句话。
  const mine = items.filter((p) => ballOf(p) === 'me').length
  const anyUnseen = items.some((p) => unseen?.has(p.id))
  const fresh = items.filter(isFresh).length   // 折着的时候也得知道里面有几张没点开过
  // 「找 workshop 机构 · 15 张」那种场景，冷邮件本来就是一批一批起的——
  // 所以叠头上要能一次勾全叠。不展开也能勾。
  const hit = items.filter((p) => picked?.has(qKey('pursuit', p.id))).length
  // 叠头也吃这一摊的色 —— 折着的时候你看见的就是这一张，它不带色等于没上色。
  // 从叠里第一张有色的卡拿号：一叠就是一次造卡任务，摊里各张拿到的号是同一个。
  const tint = items.map((p) => slotOf(p, tints)).find((x) => x !== null && x !== undefined) ?? null
  const allOn = hit === items.length && hit > 0
  // 勾的是 key 不是裸 id —— 这一摞里可能还有从 🔔 勾进来的人（2026-08-21），
  // 到群发那步要靠它分清这句话该发给谁。看板这边永远是机会线。
  const ids = items.map((p) => qKey('pursuit', p.id))

  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
  }

  return (
    <div className={'stack' + (open ? ' open' : '') + (tint === null ? '' : ' k-t' + tint)}>
      <div className="stack-head" role="button" tabIndex={0} onClick={onToggle} onKeyDown={onKey}>
        {picking && (
          <button
            type="button"
            className={'pc-check st' + (allOn ? ' on' : hit ? ' half' : '')}
            role="checkbox"
            aria-checked={allOn ? 'true' : hit ? 'mixed' : 'false'}
            aria-label={`勾选这一叠 ${items.length} 张`}
            onClick={(e) => { e.stopPropagation(); onPick(ids, !allOn) }}
          />
        )}
        {/* 这儿原来有个恒亮的琥珀色小圆点（.stack-pile），纯装饰、不带信息。
            两个毛病：一是它按叠头整体高度垂直居中，标题折几行、开不开批量操作
            都会让它挪位；二是它跟卡上那个**有意义**的球点（.pc-ball.me .bd）
            几乎同色同大小——同一个记号在卡上是「该你动」，在叠头上什么都不是。
            「这儿是一摞」已经由身后那两层垫纸、「N 张」和「展开」说了三遍。 */}
        {anyUnseen && !open && <span className="pc-badge" aria-label="有你还没读到的新消息" />}
        <span className="stack-txt">
          <span className="stack-n">{name || '一批机构'}</span>
          <span className="stack-c">
            {items.length} 张{fresh ? ` · ${fresh} 张新` : ''}{mine ? ` · ${mine} 张待处理` : ''}
            {picking && hit ? ` · 已选 ${hit}` : ''}
          </span>
        </span>
        <span className="stack-chev" aria-hidden="true">{open ? '收起' : '展开'}</span>
      </div>
      {open && items.map((p) => (
        <PCard
          p={p} st={states?.get?.(p.id)} audit={audit} tints={tints} key={p.id} onOpen={onOpen} onDragStart={onDragStart} onJot={onJot}
          unseen={unseen?.has(p.id)} picking={picking} checked={picked?.has(qKey('pursuit', p.id))} onPick={onPick}
          onDesk={desk?.has(qKey('pursuit', p.id))}
        />
      ))}
    </div>
  )
}

export default function Pipeline({ pursuits, tasks = [], states = null, audit = false, onOpen, onMove, onJot, unseen = new Set(), emptyNote = null, picking = false, picked = new Set(), onPick, desk = new Set() }) {
  // 哪一摊用几号色。整块板算一次 —— 每张卡各算各的会因为看见的卡不同而发出不同的号。
  const tints = useMemo(() => tintSlots(pursuits), [pursuits])
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
  //
  // 「算不算一摊」问 inBatch —— 跟上色同一个判断（见 lib/batchTint.js）。
  // 聚合源那批就是靠这一句散着铺开的：它们各是各的机会，不是同一封冷邮件
  // 撒出去的一批，折起来反而把「这是七个不同的机会」这件事藏了。
  const layout = (items) => {
    const counts = {}
    for (const p of items) if (inBatch(p)) counts[p.task_id] = (counts[p.task_id] || 0) + 1
    const out = []
    const seen = new Set()
    for (const p of items) {
      const tid = inBatch(p) ? p.task_id : null
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

  // 筛得一张不剩的时候，别摆七个空列——那看着像卡全丢了。
  if (emptyNote) {
    return <div className="board board-empty">{emptyNote}</div>
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
                  states={states}
                  audit={audit}
                  tints={tints}
                  open={openStacks.has(row.stack)}
                  onToggle={() => toggleStack(row.stack)}
                  onOpen={onOpen}
                  onDragStart={onDragStart}
                 
                  onJot={onJot}
                  unseen={unseen}
                  picking={picking}
                  picked={picked}
                  onPick={onPick}
                  desk={desk}
                />
              ) : (
                <PCard
                  p={row.card} st={states?.get?.(row.card.id)} audit={audit} tints={tints} key={row.card.id} onOpen={onOpen} onDragStart={onDragStart}
                  onJot={onJot} unseen={unseen.has(row.card.id)}
                  picking={picking} checked={picked.has(qKey('pursuit', row.card.id))} onPick={onPick}
                  onDesk={desk.has(qKey('pursuit', row.card.id))}
                />
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
