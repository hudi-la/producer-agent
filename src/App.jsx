import React, { useEffect, useRef, useState } from 'react'
import { loadLibrary } from './lib/loadLibrary.js'
import { loadPursuits } from './lib/loadPursuits.js'
import { loadTasks } from './lib/loadTasks.js'
import { setStage, setBall } from './lib/chat.js'
import Pipeline from './components/Pipeline.jsx'
import PursuitFocus from './components/PursuitFocus.jsx'
import Library from './components/Library.jsx'
import People from './components/People.jsx'
import TasksPanel from './components/TasksPanel.jsx'
import Mark from './components/Mark.jsx'
import { isPeopleTask, isPursuitTask } from './lib/taskAreas.js'

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

  // 看板每 8 秒刷一次机会线——渡在后台想完的回复、别处的改动都会自动进来，
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
    if (p) { focusedOnceRef.current = true; markSeen(pid); setView({ name: 'pursuit', pursuit: p }) }
  }, [pl])

  // 别的标签页把某张卡标成「已看」时，这个标签页的小红点也跟着清掉。
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'pa_seen') { try { setSeen(JSON.parse(e.newValue || '{}')) } catch (_) {} }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (tasksOpen) setTasksOpen(false)
      else if (view.name === 'pursuit') setView({ name: 'home' })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tasksOpen, view])

  if (!lib || !pl || !tk) return <div className="wrap"><div className="loading">载入中……</div></div>

  const source = pl.source === 'live' && lib.source === 'live' ? 'live' : 'seed'
  const openPursuit = (p) => {
    const url = new URL(window.location.href)
    url.searchParams.set('p', p.id)
    window.open(url.toString(), '_blank')
  }
  const closePursuit = () => {
    if (view.name === 'pursuit') markSeen(view.pursuit.id)
    window.history.replaceState(null, '', window.location.pathname)
    setView({ name: 'home' })
  }
  // 你离开期间渡回了的卡：最后一条是渡发的、且比你上次看它更新。当前打开的那张不算。
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

  // 手动钉住球权（null = 交还自动）。同样先乐观更新，写失败回滚 + 提示。
  const markBall = async (id, ball) => {
    const prev = pl.pursuits
    setPl({ ...pl, pursuits: prev.map((p) => (p.id === id ? { ...p, ball } : p)) })
    try {
      await setBall(id, ball)
    } catch (e) {
      setPl({ ...pl, pursuits: prev })
      alert('球权没保存：' + e.message)
    }
  }

  return (
    <div className="wrap">
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
        <span className={'srcbadge ' + source}>{source === 'live' ? '已连 Supabase' : '种子数据'}</span>
      </header>

      {/* 一条机会线是全屏的，进去了就不该还看见看板的工具条 */}
      {area === 'pursue' && view.name === 'home' && (
        <div className="subbar">
          {/* 这四个筛选还没接上，先占位——怎么筛你还在想。 */}
          <div className="tabs">
            <button className="tab on">按阶段</button>
            <button className="tab">按截止</button>
            <button className="tab">按作品</button>
            <button className="tab">按来源</button>
          </div>
          <span className="sp" />
          <button className="wbtn" onClick={() => setTasksOpen(true)}>造卡任务</button>
        </div>
      )}

      {area === 'people' ? (
        <People tasks={tk.tasks.filter(isPeopleTask)} pursuits={pl.pursuits} />
      ) : area === 'profile' ? (
        <Library entries={lib.entries} concerns={lib.concerns} />
      ) : view.name === 'home' ? (
        // 原来这儿有条「今天需要你的」横幅，只认「一起写」那一列。撤了：
        // 「今天该做什么」不该由某一列决定。以后要做这种提示，得有自己的依据，
        // 不能挂在某个列名上——否则用户一改列，提示就跟着错。
        <Pipeline pursuits={pl.pursuits} tasks={tk.tasks} onOpen={openPursuit} onMove={moveCard} unseen={unseen} />
      ) : (
        <PursuitFocus
          pursuit={view.pursuit}
          messages={pl.messagesByPursuit[view.pursuit.id]}
          onBack={closePursuit}
          onMove={moveCard}
          onSetBall={markBall}
        />
      )}

      {/* 造卡任务只列属于项目争取的那些——「关系降温提醒」归人际管理 */}
      <TasksPanel tasks={tk.tasks.filter(isPursuitTask)} open={tasksOpen} onClose={() => setTasksOpen(false)} />
    </div>
  )
}
