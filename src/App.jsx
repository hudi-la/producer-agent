import React, { useEffect, useRef, useState } from 'react'
import { loadLibrary } from './lib/loadLibrary.js'
import { loadPursuits } from './lib/loadPursuits.js'
import { loadTasks } from './lib/loadTasks.js'
import { loadProfile, ProfileContext, PROFILE_FALLBACK } from './lib/profile.js'
import { setStage, setBall, setActionDone, markTouched, setJot, acceptNextAction, sendMessage, markSeen as markSeenDb } from './lib/chat.js'
import Pipeline from './components/Pipeline.jsx'
import PursuitFocus from './components/PursuitFocus.jsx'
import Library from './components/Library.jsx'
import People from './components/People.jsx'
import PersonFocus from './components/PersonFocus.jsx'
import OrgFocus from './components/OrgFocus.jsx'
import { loadContacts } from './lib/loadContacts.js'
import TasksPanel from './components/TasksPanel.jsx'
import Mark from './components/Mark.jsx'
import Trouble from './components/Trouble.jsx'
import { isPeopleTask, isPursuitTask } from './lib/taskAreas.js'
import { checkBrain } from './lib/backends.js'
import Subbar from './components/Subbar.jsx'
import SayTo from './components/SayTo.jsx'
import { NO_FILTERS, anyOn, applyFilters } from './lib/filters.js'
import { loadQueue, saveQueue, normalize, enqueue, done as queueDone, later as queueLater, goto as queueGoto, allSkipped, inQueue, key as qKey, keyOf, parseKey } from './lib/queue.js'
import { refreshPursuit } from './lib/refresh.js'
import QueueRest from './components/QueueRest.jsx'

// 顶栏一级 = 三个主区。二级（筛选、造卡任务）沉到各区自己的工具条里。
// 分法：有 proposal 压力的都进项目争取（冷外联也算——它产出的仍是机会线）；
// 无 proposal 压力的关系进人际管理；关于你自己的事实进我的档案。
const AREAS = [
  ['pursue', '项目争取'],
  ['people', '人际管理'],
  ['profile', '我的档案'],
]

// '2026-08-06' → '8/6'。两位数的月日都要去掉前导零，
// 直接 slice + 一次 replace 只去得掉月份那个，会写出「8/06」。
const mdOf = (s) => {
  if (!s) return null
  const [, m, d] = s.split('-')
  return `${Number(m)}/${Number(d)}`
}

export default function App() {
  const [lib, setLib] = useState(null)
  const [pl, setPl] = useState(null)
  const [tk, setTk] = useState(null)
  // 人这一层。名片 + 他名下的往来 —— 人际管理页和过卡队列都靠它。
  const [ct, setCt] = useState(null)
  // 关于你自己的事实。卡片、详情页、档案页都要用，所以走 context 而不是一路当 prop 传。
  const [profile, setProfile] = useState(PROFILE_FALLBACK)
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
  const [refreshing, setRefreshing] = useState(null)      // {i, n} | null
  const [refreshFailed, setRefreshFailed] = useState(0)   // 上一轮挂了几条，Trouble 用
  const [sayOpen, setSayOpen] = useState(false)
  const [saying, setSaying] = useState(null)              // {i, n} | null
  const [sayFailed, setSayFailed] = useState(0)           // 群发挂了几条，也归 Trouble 说

  // 进队的判据是「现在需要你」，不是「库里多了行数据」。
  // 第一次真跑就吃过亏：提了个 8-12 才要做的事，8-6 就吵人。
  //   ① 对方来信（addedIn）——你自己发的信被收录不惊动你，你知道你发过
  //   ② 有话跟你说——待办被作废；提案只有现在就能动的（无日期或到了）才算
  // （原来还有一条「行动时间到了」，撤了：那件事两个筛选开关已经在做，见 filters.js）
  const needsMe = (out) => {
    if (out.addedIn > 0 || out.voided) return true
    if (!out.proposed) return false
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return !out.touch || new Date(out.touch + 'T00:00:00') <= today
  }

  // 串行逐线。几十条里多数没邮件，brain 秒回；有信的那几条各要十几秒。
  // 需要你的线当场进队（via: 'update'）——不等整轮跑完，先到先过。
  const runRefresh = async () => {
    if (refreshing) return
    const list = pl.pursuits
    setRefreshFailed(0)
    let failed = 0
    for (let i = 0; i < list.length; i++) {
      setRefreshing({ i: i + 1, n: list.length })
      try {
        const out = await refreshPursuit(list[i].id)
        if (needsMe(out)) {
          setQueue((q) => enqueue(q, [{ kind: 'pursuit', id: list[i].id, via: 'update' }]))
        }
      } catch (_) {
        failed++
      }
    }
    setRefreshing(null)
    setRefreshFailed(failed)
    const r = await loadPursuits()          // 立刻把新状态拉回来，不等 8 秒轮询
    if (r) setPl(r)
  }

  // 群发：同一句话分别说给每条线，各答各的。
  //
  // 串行，一条十几秒——跟 runRefresh 一个节奏。答完的当场进队，先到先过。
  // 批次标识用一个时间戳串：同一批的每条消息带同一个 batch，将来要认出
  // 「这几条是一次群发」也认得出来。
  const runSay = async (text) => {
    if (saying) return
    const ids = [...picked]
    if (!ids.length) return
    setSayOpen(false)
    cancelPick()
    setSayFailed(0)
    const batch = new Date().toISOString()
    const meta = { broadcast: { batch, count: ids.length } }
    let failed = 0
    for (let i = 0; i < ids.length; i++) {
      setSaying({ i: i + 1, n: ids.length })
      try {
        await sendMessage(ids[i], text, meta)
        setQueue((q) => enqueue(q, [{ kind: 'pursuit', id: ids[i], via: 'say' }]))
      } catch (_) {
        failed++
      }
    }
    setSaying(null)
    setSayFailed(failed)
    const r = await loadPursuits()
    if (r) setPl(r)
  }

  // 这一行必须待在这儿（状态旁边），不能挪到组件下半截去。
  // 下面那个 Esc 的 useEffect 会用它，而那个 effect 在「载入中」的早退 return
  // **上面**——定义写在早退下面的话，数据还没到时按 Esc 就是 TDZ 报错。
  const cancelPick = () => { setPicking(false); setPicked(new Set()) }
  // null = 还没测出来（先别报警，免得刚打开页面就闪一下红）
  const [brain, setBrain] = useState(null)
  const focusedOnceRef = useRef(false)
  const migratedRef = useRef(false)

  // 「读到这儿了」写进库（0030 的 pursuit_seen）。跟卡走，不跟浏览器走。
  //
  // 先就地把 unread 关掉再写库：小红点该在你点开的那一瞬间灭，不该等一趟网络。
  // 写失败也不回滚——最坏是下一次 8 秒轮询把它带回来，比卡在那儿转圈强。
  const markSeen = (id) => {
    setPl((cur) => {
      if (!cur) return cur
      const hit = cur.pursuits.find((p) => p.id === id)
      // 没变化就原样返回 —— 下面那个「正看着的这张随时算已看」的 effect 依赖 pl，
      // 每次都造个新对象的话它会自己触发自己，停不下来。
      if (!hit || !hit.unread) return cur
      return { ...cur, pursuits: cur.pursuits.map((p) => (p.id === id ? { ...p, unread: false } : p)) }
    })
    markSeenDb(id).catch(() => {})
  }

  const reloadContacts = () => loadContacts().then(setCt)

  useEffect(() => {
    loadLibrary().then(setLib)
    loadPursuits().then(setPl)
    loadTasks().then(setTk)
    loadProfile().then(setProfile)
    loadContacts().then(setCt)
  }, [])

  // 人这一层**不进过卡队列**。
  //
  // 队列是「你还欠着几件事」——它是项目争取那边的形状：一条线有阶段、有截止，
  // 需要你一张张过。人不是：由头在人际管理页上就是一行字，看见了点进去办完就完了。
  // 硬塞进队列只会让那个数字混进另一种东西，而那个数字现在说的是一句准话。
  //
  // queue.js 里的 kind 支持留着（旧存档兼容 + 将来要接也不用再迁存储），
  // 但今天没有任何东西往队里塞 contact。

  useEffect(() => { saveQueue(queue) }, [queue])

  // 库换过之后（seed ↔ live，id 完全是两套），localStorage 里可能躺着一批
  // 已经不存在的 id。不清掉的话顶栏会显示一个点了没反应的数字——那是在说谎。
  //
  // **只清机会线那一半。** 队里现在还躺着人（kind='contact'），他们的死活
  // 由 ct 那份数据说了算——拿 pl 的 id 表去筛人，会把每一个人都当成幽灵清掉。
  useEffect(() => {
    if (!pl) return
    const live = new Set(pl.pursuits.map((p) => p.id))
    setQueue((q) => {
      const items = q.items.filter((x) => x.kind !== 'pursuit' || live.has(x.id))
      return items.length === q.items.length ? q : normalize({ items, at: q.at })
    })
  }, [pl])

  // 一次性搬迁：把旧的 localStorage['pa_seen'] 推进库里。
  //
  // 不搬的话，改完第一次打开时你读过的每一条线都会重新变红——那份记录是真的，
  // 不能因为换了个存法就当它不存在。
  //
  // 只跑一次，跑完盖个记号（**不删原值**，万一搬错了还查得回来）。
  // 库里那边只前进不后退，所以搬进去的旧时间戳压不掉任何已有的阅读进度。
  useEffect(() => {
    if (!pl || pl.source !== 'live' || migratedRef.current) return
    migratedRef.current = true
    let old
    try {
      if (localStorage.getItem('pa_seen_migrated')) return
      old = JSON.parse(localStorage.getItem('pa_seen') || '{}')
    } catch (_) { return }
    const ids = new Set(pl.pursuits.map((p) => p.id))
    const rows = Object.entries(old || {}).filter(([id, at]) => ids.has(id) && at)
    if (!rows.length) {
      try { localStorage.setItem('pa_seen_migrated', new Date().toISOString()) } catch (_) {}
      return
    }
    ;(async () => {
      let ok = 0
      for (const [id, at] of rows) {
        try { await markSeenDb(id, at); ok++ } catch (_) {}
      }
      // 全部成功才盖记号——半路失败的话下次开页面接着搬（RPC 幂等，重来没副作用）
      if (ok === rows.length) {
        try { localStorage.setItem('pa_seen_migrated', new Date().toISOString()) } catch (_) {}
        const r = await loadPursuits()
        if (r) setPl(r)
      }
    })()
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

  // 「已看」不再走 localStorage —— 它在库里，8 秒一次的轮询自然会把别处的阅读
  // 带过来，而且跨浏览器、跨机器都算数（原来只有同一个浏览器的标签页之间才同步）。
  // 队列还在本地，所以这个监听留着。
  useEffect(() => {
    const onStorage = (e) => {
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
      else if (view.name === 'person' || view.name === 'org') setView({ name: 'home' })
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
  // 你离开期间 Fairwind 说了话、你还没读到的卡。判据在库里算（0030 的 v_pa_pursuits.unread）：
  // 最后一条是 Fairwind 说的、不是建卡那份 brief、且晚于你上次读这条线。
  // 对方来信不直接点红点——收信时 Fairwind 会补一句告知，由那句来点。
  // 当前正开着的那张不算。
  const unseen = new Set(
    pl.pursuits
      .filter((p) => p.unread && !(view.name === 'pursuit' && view.pursuit.id === p.id))
      .map((p) => p.id)
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
  //
  // 队里现在混着两种东西，所以进来的是 key（'pursuit:xxx' / 'contact:xxx'）
  // 不是裸 id —— 拆开之后各开各的抽屉。
  const openQueueCard = (k) => {
    if (!k) return
    const { id } = parseKey(k)      // 队里现在只有机会线，见上面那段
    const p = pl.pursuits.find((x) => x.id === id)
    if (p) { setArea('pursue'); markSeen(id); setView({ name: 'pursuit', pursuit: p, mode: 'drawer' }) }
  }

  // 过一遍：不跑任何东西，直接把勾中的端上工作台。
  const pickAll = () => {
    const entries = [...picked].map((id) => ({ kind: 'pursuit', id, via: 'pick' }))
    if (!entries.length) return
    const q = enqueue(queue, entries)
    setQueue(q)
    cancelPick()
    openQueueCard(q.at)
  }

  // 抽屉正看的这张在不在队里。在 = 显示队头和两个出口。
  // 队里只有机会线（人这一层不进队，见上面那段）。
  const viewKey = view.name === 'pursuit' ? qKey('pursuit', view.pursuit.id) : null
  const atQueue = Boolean(viewKey) && inQueue(queue, viewKey)
  const qItem = atQueue ? queue.items.find((x) => keyOf(x) === viewKey) : null
  const qInfo = atQueue ? {
    i: queue.items.findIndex((x) => keyOf(x) === viewKey),
    n: queue.items.length,
    // '2026-08-06' → '8/6'。你什么时候放过它的，得看得见。
    skippedAt: mdOf(qItem?.skippedAt),
    // 这张卡怎么进队的：'pick' 你自己勾的 / 'update' 更新最新信息送来的 /
    // 'say' 群发那句送来的 / 四种由头（bump·circleback·thanks·met）。
    // 抽屉靠它决定要不要摆「这次发生了什么」。
    via: qItem?.via || null,
  } : null
  // 剩下的全放过了：抽屉不再摆卡，改摆一句话然后停手。
  //
  // 但只在你**刚按完那下「再等一等」**的时候（view.rest 是 laterCard 立的标）。
  // 光看 allSkipped 的话，之后你从看板点开任何一张恰好在队里的卡，
  // 抽屉都会拿这句话把卡顶掉——你明确要看的东西变得不可见，那就是丢了。
  const resting = atQueue && allSkipped(queue) && Boolean(view.rest)

  const queueGo = (d) => {
    const q = queueGoto({ ...queue, at: viewKey }, d)
    setQueue(q)
    openQueueCard(q.at)
  }
  // 移出：从这一摞里拿走。**就这一个意思。**
  //
  // 原来它还偷偷替你认领 Fairwind 提的下一步（next_action_by → you）。
  // 那是让队列去替卡里的事实说话：「队列里有没有它」和「这件事做没做完」是两回事，
  // 一个按钮断言两件事，就有一件迟早是假的。认领搬到那句提案自己旁边去了。
  const finishCard = () => {
    const q = queueDone(queue, viewKey)
    setQueue(q)
    if (!q.items.length) closePursuit()
    else openQueueCard(q.at)
  }
  // 你认了它提的那句：记号消失。这是对**那句话**表态，
  // 跟「这张卡还在不在我手头」无关——所以它不在过卡器的出口上。
  // 先乐观更新再写库：认领是你已经做出的判断，界面不该等一趟网络才承认。
  const acceptProposal = async (id) => {
    setPl((cur) => cur && ({ ...cur, pursuits: cur.pursuits.map((x) => (x.id === id ? { ...x, next_action_by: 'you' } : x)) }))
    try { await acceptNextAction(id) } catch (e) { alert('没认上（下次更新它还会带记号）：' + e.message) }
  }
  const laterCard = () => {
    const q = queueLater(queue, viewKey)
    setQueue(q)
    // 全放过了：不换卡，在 view 上立个 rest 标——停手面板只在这一刻出现。
    if (!allSkipped(q)) openQueueCard(q.at)
    else setView((v) => ({ ...v, rest: true }))
  }

  const onPursuit = area === 'pursue' && view.name === 'pursuit'
  const paged = onPursuit && view.mode === 'page'     // 整页：看板让位
  const drawered = onPursuit && !paged                // 抽屉：看板留着
  // 打开的那条线，永远取 pl 里最新的那一份。
  // view.pursuit 是**你点开那一刻的快照**——乐观更新和 8 秒轮询都只动 pl，不动它，
  // 所以照着快照渲染的话，你在抽屉里点「认了」，看板上的记号消失了、抽屉里那个还在。
  // 找不到（刚被过滤掉/还没读回来）就退回快照，卡不能因此空掉。
  const openedPursuit = onPursuit
    ? (pl.pursuits.find((x) => x.id === view.pursuit.id) || view.pursuit)
    : null
  // 名片同理：改完一格要立刻显示新值，所以永远取 ct 里最新那一份。
  const openedPerson = view.name === 'person'
    ? (ct?.contacts?.find((x) => x.id === view.person.id) || view.person)
    : null

  return (
   <ProfileContext.Provider value={profile}>
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
        {/* 过卡入口原来在这儿。挪进工具条了——顶栏常驻角标本身就是一句主张：
            「你有一摊持续欠着的事」。队列已经不是那个东西（它只说「这批还剩几张」），
            就不该站在这儿。谁生的跟谁站。 */}
      </header>

      {/* 一切正常时这里什么都不渲染 */}
      <Trouble
        fellBack={fellBack}
        detail={fellBackDetail}
        brainDown={brain ? !brain.up : false}
        brainStale={brain ? brain.stale : false}
        batchFailed={refreshFailed + sayFailed}
      />

      {/* 整页看一条线时不该还看见看板的工具条。抽屉不算——看板还在旁边开着。 */}
      {area === 'pursue' && !paged && (
        <Subbar
          filters={filters}
          onToggleFilter={toggleFilter}
          onSetFilters={setFilters}
          picking={picking}
          pickedCount={picked.size}
          hiddenPickedCount={hiddenPicked}
          onStartPick={() => setPicking(true)}
          onCancelPick={cancelPick}
          onPickAll={pickAll}
          onOpenTasks={() => setTasksOpen(true)}
          onRefresh={runRefresh}
          refreshing={refreshing}
          onSay={() => setSayOpen(true)}
          saying={saying}
          queueCount={queue.items.length}
          onOpenQueue={() => openQueueCard(queue.at)}
        />
      )}

      {area === 'people' ? (
        view.name === 'person' ? (
          <PersonFocus
            key={view.person.id}
            person={openedPerson}
            onBack={() => setView({ name: 'home' })}
            onChanged={reloadContacts}
            onOpenPursuit={(id) => { setArea('pursue'); openPursuit(pl.pursuits.find((p) => p.id === id)) }}
          />
        ) : view.name === 'org' ? (
          <OrgFocus
            key={view.org.org}
            org={ct?.orgs?.find((o) => o.org === view.org.org) || view.org}
            onBack={() => setView({ name: 'home' })}
            onOpenPerson={(id) => {
              const c = ct?.contacts?.find((x) => x.id === id)
              if (c) setView({ name: 'person', person: c })
            }}
            onOpenPursuit={(id) => { setArea('pursue'); openPursuit(pl.pursuits.find((p) => p.id === id)) }}
          />
        ) : (
          <People
            contacts={ct?.contacts || []}
            orgs={ct?.orgs || []}
            strangers={ct?.strangers || []}
            msgsByContact={ct?.msgsByContact || {}}
            fellBack={ct?.reason || null}
            onOpen={(c) => setView({ name: 'person', person: c })}
            onOpenOrg={(o) => setView({ name: 'org', org: o })}
            onAdded={reloadContacts}
          />
        )
      ) : area === 'profile' ? (
        <Library entries={lib.entries} concerns={lib.concerns}
                 onProfileSaved={() => loadProfile().then(setProfile)} />
      ) : paged ? (
        <PursuitFocus
          // key：换一条线就换一个实例。不加的话 React 复用同一个，thinking / text /
          // 在飞的请求会跨卡片留着——你在 A 卡问完立刻点开 B 卡，B 卡会凭空转起点点，
          // 而 A 的回复回来时还会塞进你正看着的 B 卡里。
          key={view.pursuit.id}
          variant="page"
          pursuit={openedPursuit}
          messages={pl.messagesByPursuit[view.pursuit.id]}
          onBack={closePursuit}
          onMove={moveCard}
          onSetBall={markBall}
          // 整页也有那条活待办，「认了」在哪儿都得真能点——
          // 摆一个按不动的按钮比不摆更糟。
          onAccept={acceptProposal}
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
            <aside className="drawer" aria-label={resting ? '过卡' : view.pursuit.title}>
              {resting ? (
                <QueueRest n={queue.items.length} onClose={closePursuit} />
              ) : (
                <PursuitFocus
                  key={view.pursuit.id}
                  variant="drawer"
                  pursuit={openedPursuit}
                  messages={pl.messagesByPursuit[view.pursuit.id]}
                  onBack={closePursuit}
                  onExpand={expandPursuit}
                  onMove={moveCard}
                  onSetBall={markBall}
                  queue={qInfo}
                  onQueuePrev={() => queueGo(-1)}
                  onQueueNext={() => queueGo(1)}
                  onQueueDone={finishCard}
                  onQueueLater={laterCard}
                  onAccept={acceptProposal}
                />
              )}
            </aside>
          )}
        </>
      )}

      {/* 一条都没勾就没有「对选中的 0 条线」这回事 —— 干脆不摆 */}
      {sayOpen && picked.size > 0 && (
        <SayTo n={picked.size} onSend={runSay} onCancel={() => setSayOpen(false)} />
      )}

      {/* 造卡任务只列属于项目争取的那些——「关系降温提醒」归人际管理 */}
      <TasksPanel tasks={tk.tasks.filter(isPursuitTask)} open={tasksOpen} onClose={() => setTasksOpen(false)} />
    </div>
   </ProfileContext.Provider>
  )
}
