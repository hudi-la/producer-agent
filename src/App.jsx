import React, { useEffect, useRef, useState } from 'react'
import { loadLibrary } from './lib/loadLibrary.js'
import { loadPursuits } from './lib/loadPursuits.js'
import { loadTasks } from './lib/loadTasks.js'
import { setStage, setBall, setActionDone, markTouched, setJot } from './lib/chat.js'
import Pipeline from './components/Pipeline.jsx'
import PursuitFocus from './components/PursuitFocus.jsx'
import Library from './components/Library.jsx'
import People from './components/People.jsx'
import TasksPanel from './components/TasksPanel.jsx'
import Mark from './components/Mark.jsx'
import Trouble from './components/Trouble.jsx'
import { isPeopleTask, isPursuitTask } from './lib/taskAreas.js'
import { checkBrain } from './lib/backends.js'
import Subbar from './components/Subbar.jsx'
import { NO_FILTERS, anyOn, applyFilters } from './lib/filters.js'
import { loadQueue, saveQueue, normalize, enqueue } from './lib/queue.js'

// 顶栏一级 = 三个主区。二级（筛选、造卡任务）沉到各区自己的工具条里。
// 分法：有 proposal 压力的都进项目争取（冷外联也算——它产出的仍是机会线）；
// 无 proposal 压力的关系进人际管理；关于你自己的事实进我的档案。
const AREAS = [
  ['pursue', '项目争取'],
  ['people', '人际管理'],
  ['profile', '我的档案'],
]

export default function App() {
  const [lib, setLib] = useState(null)
  const [pl, setPl] = useState(null)
  const [tk, setTk] = useState(null)
  const [view, setView] = useState({ name: 'home' })
  const [area, setArea] = useState('pursue')
  const [tasksOpen, setTasksOpen] = useState(false)
  // 看哪些。两个开关都关 = 全部。切镜头只改看得见什么，不改任何数据。
  const [filters, setFilters] = useState(NO_FILTERS)
  // 批量操作：你勾出来的那一批。切镜头不清空 —— 切一下就无声无息没了，
  // 那是「看不见 = 丢了」的近亲。
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  // 手头这摊活。存 localStorage，不上库（见 lib/queue.js 开头）。
  const [queue, setQueue] = useState(loadQueue)

  // 这一行必须待在这儿（状态旁边），不能挪到组件下半截去。
  // 下面那个 Esc 的 useEffect 会用它，而那个 effect 在「载入中」的早退 return
  // **上面**——定义写在早退下面的话，数据还没到时按 Esc 就是 TDZ 报错。
  const cancelPick = () => { setPicking(false); setPicked(new Set()) }
  // null = 还没测出来（先别报警，免得刚打开页面就闪一下红）
  const [brain, setBrain] = useState(null)
  const [seen, setSeen] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pa_seen') || '{}') } catch (_) { return {} }
  })
  const focusedOnceRef = useRef(false)

  const markSeen = (id) => setSeen((s) => {
    const next = { ...s, [id]: new Date().toISOString() }
    try { localStorage.setItem('pa_seen', JSON.stringify(next)) } catch (_) {}
    return next
  })

  useEffect(() => {
    loadLibrary().then(setLib)
    loadPursuits().then(setPl)
    loadTasks().then(setTk)
  }, [])

  useEffect(() => { saveQueue(queue) }, [queue])

  // 库换过之后（seed ↔ live，id 完全是两套），localStorage 里可能躺着一批
  // 已经不存在的 id。不清掉的话顶栏会显示一个点了没反应的数字——那是在说谎。
  useEffect(() => {
    if (!pl) return
    const live = new Set(pl.pursuits.map((p) => p.id))
    setQueue((q) => {
      const items = q.items.filter((x) => live.has(x.id))
      return items.length === q.items.length ? q : normalize({ items, at: q.at })
    })
  }, [pl])

  // 脑子是本机进程，你随时会把那个终端关掉。每 20 秒探一次，
  // 关了就报警、开回来就自动消失——不用刷新页面。
  useEffect(() => {
    let alive = true
    const ping = () => checkBrain().then((r) => { if (alive) setBrain(r) })
    ping()
    const iv = setInterval(ping, 20000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  // 正看着的这张，随时算已看。
  //
  // 原来只在「关掉详情」时标一次，可抽屉是开着不关、一张接一张过的——
  // 从 A 卡直接点 B 卡，A 从来没被标记过，于是它一不再是「当前这张」，
  // 小红点立刻就回来了：你明明读过了，它还说你没读。
  // 跟着 pl 走（每 8 秒一刷），所以你读着的时候进来的新回复也算读过了。
  useEffect(() => {
    if (view.name === 'pursuit' && view.pursuit?.id) markSeen(view.pursuit.id)
  }, [view.name, view.pursuit?.id, pl])

  // 看板每 8 秒刷一次机会线——Fairwind 在后台想完的回复、别处的改动都会自动进来，
  // 不用你手动刷新。
  useEffect(() => {
    const iv = setInterval(() => { loadPursuits().then((r) => { if (r) setPl(r) }) }, 8000)
    return () => clearInterval(iv)
  }, [])

  // 从 URL 的 ?p=<id> 直接进到那条机会线（新标签页打开时用）。只做一次。
  useEffect(() => {
    if (!pl || focusedOnceRef.current) return
    const pid = new URLSearchParams(window.location.search).get('p')
    if (!pid) { focusedOnceRef.current = true; return }
    const p = pl.pursuits.find((x) => x.id === pid)
    // 带 ?p= 打开的标签页是「整页」那一档——你专门为这条线开了个标签页，
    // 就别再给它旁边塞半个看板。
    if (p) { focusedOnceRef.current = true; markSeen(pid); setView({ name: 'pursuit', pursuit: p, mode: 'page' }) }
  }, [pl])

  // 别的标签页把某张卡标成「已看」时，这个标签页的小红点也跟着清掉。
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'pa_seen') { try { setSeen(JSON.parse(e.newValue || '{}')) } catch (_) {} }
      // 别的标签页把一张卡结掉了，这个标签页顶栏的数字也跟着降。
      if (e.key === 'pa_queue') { try { setQueue(normalize(JSON.parse(e.newValue || 'null'))) } catch (_) {} }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (picking) cancelPick()
      else if (tasksOpen) setTasksOpen(false)
      // Esc 是关抽屉最顺手的动作，所以它得跟点「收起」做一样的事——
      // 也标已看、也把 ?p= 从地址栏抹掉。原来它只换了 view，小红点会赖着不走。
      else if (view.name === 'pursuit') {
        markSeen(view.pursuit.id)
        window.history.replaceState(null, '', window.location.pathname)
        setView({ name: 'home' })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tasksOpen, view, picking])

  if (!lib || !pl || !tk) return <div className="wrap"><div className="loading">载入中……</div></div>

  // 哪个 loader 先出的问题就报哪个——机会线优先，那是主战场。
  const fellBack = pl.reason || lib.reason || tk.reason || null
  const fellBackDetail = pl.reason ? pl.detail : lib.reason ? lib.detail : tk.detail
  // 点卡片：右边划出抽屉，看板留在左边——大多数时候你只是想看一眼这条线怎么样了，
  // 看完接着看下一张。整页换掉太重。
  const openPursuit = (p) => setView({ name: 'pursuit', pursuit: p, mode: 'drawer' })
  // 「整页」：还是新开一个标签页（?p=<id>）。好处是几条线可以各占一个标签页并排看。
  const expandPursuit = (p) => {
    const url = new URL(window.location.href)
    url.searchParams.set('p', p.id)
    window.open(url.toString(), '_blank')
  }
  const closePursuit = () => {
    if (view.name === 'pursuit') markSeen(view.pursuit.id)
    window.history.replaceState(null, '', window.location.pathname)
    setView({ name: 'home' })
  }
  // 你离开期间 Fairwind 回了的卡：最后一条是 Fairwind 发的、且比你上次看它更新。当前打开的那张不算。
  const unseen = new Set(
    pl.pursuits.filter((p) => {
      if (view.name === 'pursuit' && view.pursuit.id === p.id) return false
      const list = pl.messagesByPursuit[p.id]
      const last = list && list[list.length - 1]
      const seenAt = seen[p.id] ? new Date(seen[p.id]).getTime() : 0
      return last && last.role === 'producer' && new Date(last.created_at).getTime() > seenAt
    }).map((p) => p.id)
  )

  // 移卡：先乐观更新，再写回库；写失败就回滚 + 提示
  const moveCard = async (id, stage) => {
    const prev = pl.pursuits
    const cur = prev.find((p) => p.id === id)
    if (!cur || cur.stage === stage) return
    setPl({ ...pl, pursuits: prev.map((p) => (p.id === id ? { ...p, stage } : p)) })
    try {
      await setStage(id, stage)
    } catch (e) {
      setPl({ ...pl, pursuits: prev })
      alert('移动没保存：' + e.message)
    }
  }

  // 勾掉「下一步」。做完一件事该立刻看见它被划掉，所以先动界面再写库。
  //   action —— 只写完成时间戳，next_action 原文留着（详情页仍看得见，也能取消勾）
  //   touch  —— 记下今天碰过了，把待碰日清掉。这个没有撤销。
  const tickAction = async (p, what) => {
    const prev = pl.pursuits
    const patch = what === 'touch'
      ? { last_touch_at: new Date().toISOString().slice(0, 10), next_touch_at: null }
      : { next_action_done_at: new Date().toISOString() }
    setPl({ ...pl, pursuits: prev.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) })
    try {
      if (what === 'touch') await markTouched(p.id)
      else await setActionDone(p.id, true)
    } catch (e) {
      setPl({ ...pl, pursuits: prev })
      alert('没勾上：' + e.message)
    }
  }

  // 卡上随手记的几个字。写失败要把原文还回去——你刚打的字不能因为网络就没了。
  const jotCard = async (p, jot) => {
    const prev = pl.pursuits
    setPl({ ...pl, pursuits: prev.map((x) => (x.id === p.id ? { ...x, jot: jot || null } : x)) })
    try {
      await setJot(p.id, jot)
    } catch (e) {
      setPl({ ...pl, pursuits: prev })
      alert('这一笔没记上：' + e.message + '\n\n你写的是：' + jot)
    }
  }

  // 改球权那个标。同样先乐观更新，写失败回滚 + 提示。
  // ball_eff 是库算出来的「球在谁那边」，界面读的就是它——乐观更新得连它一起改，
  // 不然点完标不动，看着像没生效。
  const markBall = async (id, ball) => {
    const prev = pl.pursuits
    setPl({ ...pl, pursuits: prev.map((p) => (p.id === id ? { ...p, ball, ball_eff: ball } : p)) })
    try {
      await setBall(id, ball)
    } catch (e) {
      setPl({ ...pl, pursuits: prev })
      alert('球权没保存：' + e.message)
    }
  }

  // 当前镜头里看得见的卡。Pipeline 拿这一份画，所以列头的计数天然就是
  // 「当前视图里的张数」——不是总数。（不然你筛完看见「新机会 26」下面只有
  // 3 张，那个 26 在骗人。）
  const shown = applyFilters(pl.pursuits, filters)
  const toggleFilter = (key) => setFilters((f) => ({ ...f, [key]: !f[key] }))
  // 筛出来一张都没有，说人话。「待处理」大概率就是很稀——0017 撤掉「从 stage
  // 猜球权」之后，有依据的待处理从 28 张掉到 1 张。那是真的，不是筛坏了。
  const emptyNote = !shown.length && anyOn(filters)
    ? (filters.mine && filters.urgent ? '没有既该你动、又快到期的线。'
      : filters.mine ? '现在没有球在你这边的线。'
      : '没有 14 天内到期的线。')
    : null

  // 勾了但当前镜头看不见的那几张。照实说出来，不假装它们都在眼前。
  const shownIds = new Set(shown.map((p) => p.id))
  const hiddenPicked = [...picked].filter((id) => !shownIds.has(id)).length

  const pick = (ids, on) => setPicked((s) => {
    const next = new Set(s)
    for (const id of ids) on ? next.add(id) : next.delete(id)
    return next
  })

  // 打开队里的某一张。队列和 view 是两件事：view 说「抽屉现在看哪张」，
  // 队列说「你还欠着哪几件」。收起抽屉不动队列。
  const openQueueCard = (id) => {
    const p = pl.pursuits.find((x) => x.id === id)
    if (p) { markSeen(id); setView({ name: 'pursuit', pursuit: p, mode: 'drawer' }) }
  }

  // 过一遍：不跑任何东西，直接把勾中的端上工作台。
  const pickAll = () => {
    const entries = [...picked].map((id) => ({ id, via: 'pick' }))
    if (!entries.length) return
    const q = enqueue(queue, entries)
    setQueue(q)
    cancelPick()
    openQueueCard(q.at)
  }

  const onPursuit = area === 'pursue' && view.name === 'pursuit'
  const paged = onPursuit && view.mode === 'page'     // 整页：看板让位
  const drawered = onPursuit && !paged                // 抽屉：看板留着

  return (
    <div className={'wrap' + (drawered ? ' drawered' : '')}>
      <header className="app-top">
        <div className="brand"><Mark /><span className="name">Fairwind</span></div>
        <nav className="areas" aria-label="主区">
          {AREAS.map(([key, label]) => (
            <button
              key={key}
              className={'area' + (area === key ? ' on' : '')}
              onClick={() => { setArea(key); if (view.name !== 'home') closePursuit() }}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="sp" />
        {/* 队空的时候整个按钮不渲染。不显示「过卡 · 0」——这一刀刚撤掉四个占位的。 */}
        {queue.items.length > 0 && (
          <button className="qbtn" onClick={() => openQueueCard(queue.at)}>
            <span className="qpile" aria-hidden="true" />过卡 · {queue.items.length}
          </button>
        )}
      </header>

      {/* 一切正常时这里什么都不渲染 */}
      <Trouble
        fellBack={fellBack}
        detail={fellBackDetail}
        brainDown={brain ? !brain.up : false}
        brainStale={brain ? brain.stale : false}
      />

      {/* 整页看一条线时不该还看见看板的工具条。抽屉不算——看板还在旁边开着。 */}
      {area === 'pursue' && !paged && (
        <Subbar
          filters={filters}
          onToggleFilter={toggleFilter}
          picking={picking}
          pickedCount={picked.size}
          hiddenPickedCount={hiddenPicked}
          onStartPick={() => setPicking(true)}
          onCancelPick={cancelPick}
          onPickAll={pickAll}
          onOpenTasks={() => setTasksOpen(true)}
        />
      )}

      {area === 'people' ? (
        <People tasks={tk.tasks.filter(isPeopleTask)} pursuits={pl.pursuits} />
      ) : area === 'profile' ? (
        <Library entries={lib.entries} concerns={lib.concerns} />
      ) : paged ? (
        <PursuitFocus
          // key：换一条线就换一个实例。不加的话 React 复用同一个，thinking / text /
          // 在飞的请求会跨卡片留着——你在 A 卡问完立刻点开 B 卡，B 卡会凭空转起点点，
          // 而 A 的回复回来时还会塞进你正看着的 B 卡里。
          key={view.pursuit.id}
          variant="page"
          pursuit={view.pursuit}
          messages={pl.messagesByPursuit[view.pursuit.id]}
          onBack={closePursuit}
          onMove={moveCard}
          onSetBall={markBall}
        />
      ) : (
        <>
          {/* 原来这儿有条「今天需要你的」横幅，只认「一起写」那一列。撤了：
              「今天该做什么」不该由某一列决定。以后要做这种提示，得有自己的依据，
              不能挂在某个列名上——否则用户一改列，提示就跟着错。 */}
          <Pipeline pursuits={shown} emptyNote={emptyNote} tasks={tk.tasks} onOpen={openPursuit} onMove={moveCard} onTick={tickAction} onJot={jotCard} unseen={unseen} picking={picking} picked={picked} onPick={pick} />
          {/* 不加遮罩：抽屉开着的时候看板必须还能点，你要的就是一张接一张地过。 */}
          {/* aside 而不是 dialog——它不挡着你操作看板，就是旁边多开的一块地方 */}
          {drawered && (
            <aside className="drawer" aria-label={view.pursuit.title}>
              <PursuitFocus
                key={view.pursuit.id}
                variant="drawer"
                pursuit={view.pursuit}
                messages={pl.messagesByPursuit[view.pursuit.id]}
                onBack={closePursuit}
                onExpand={expandPursuit}
                onMove={moveCard}
                onSetBall={markBall}
              />
            </aside>
          )}
        </>
      )}

      {/* 造卡任务只列属于项目争取的那些——「关系降温提醒」归人际管理 */}
      <TasksPanel tasks={tk.tasks.filter(isPursuitTask)} open={tasksOpen} onClose={() => setTasksOpen(false)} />
    </div>
  )
}
