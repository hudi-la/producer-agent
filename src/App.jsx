import React, { useEffect, useRef, useState } from 'react'
import { t } from './i18n/index.js'
import { loadLibrary } from './lib/loadLibrary.js'
import { loadPursuits } from './lib/loadPursuits.js'
import { loadTasks } from './lib/loadTasks.js'
import { loadProfile, ProfileContext, PROFILE_FALLBACK } from './lib/profile.js'
import { setStage, setBall, setJot, sendMessage, markSeen as markSeenDb, markContactSeen as markContactSeenDb } from './lib/chat.js'
import Pipeline from './components/Pipeline.jsx'
import PursuitFocus from './components/PursuitFocus.jsx'
import Library from './components/Library.jsx'
import People from './components/People.jsx'
import PersonFocus from './components/PersonFocus.jsx'
import OrgFocus from './components/OrgFocus.jsx'
import { loadContacts } from './lib/loadContacts.js'
import { setTz } from './lib/when.js'
import { toUrl, fromUrl } from './lib/route.js'
import TasksPanel from './components/TasksPanel.jsx'
import Opportunities from './components/Opportunities.jsx'
import { loadPool } from './lib/opportunities.js'
import Mark from './components/Mark.jsx'
import Trouble from './components/Trouble.jsx'
import DrawerGrip, { restoreDrawerWidth } from './components/DrawerGrip.jsx'
import { isPeopleTask, isPursuitTask } from './lib/taskAreas.js'
import { checkBrain, BRAIN, DB_MODE } from './lib/backends.js'
import SettingsPage from './components/SettingsPage.jsx'
import { onPulse } from './lib/pulse.js'
import { cleanCopy } from './lib/cleanCopy.js'
import SayTo from './components/SayTo.jsx'
import { loadQueue, saveQueue, normalize, enqueue, done as queueDone, select as queueSelect, inQueue, key as qKey, keyOf, parseKey } from './lib/queue.js'
import { deskTabs, deskView, autoOpen } from './lib/desk.js'
import { flyTo } from './lib/fly.js'
import { refreshPursuit } from './lib/refresh.js'
import { loadNotifications, markHandled, rescheduleWait, triage, rejudge, REJUDGE_BATCH } from './lib/notifications.js'
import { migrateCueOff } from './lib/cueoffMigrate.js'
import DeskTabs from './components/DeskTabs.jsx'
import MailState from './components/MailState.jsx'
import PickBar from './components/PickBar.jsx'
import Notifications from './components/Notifications.jsx'
import Timeline from './components/Timeline.jsx'
import { VeilContext, loadVeiled, saveVeiled } from './lib/veil.js'
import { Flower } from './components/Veil.jsx'
// 模块开关(2026-09-16):关着的模块,它的主区、顶栏件、邮件界面都不出现。云端永远全开
import { useModules } from './lib/ModulesContext.jsx'
import { allowedAreas } from './lib/modules.js'

// 顶栏一级：头一个是**桌面**（工作区——今天摊在桌上的活），后面四个是**架子**
// （东西住的地方，你去找到一个拿到桌上来做）。桌子满、架子安静，本来就是两种东西。
// 见 docs/specs/2026-09-02-workspace-design.md。
// 架子的分法：有 proposal 压力的都进项目争取（冷外联也算——它产出的仍是机会线）；
// 无 proposal 压力的关系进人际管理；关于你自己的事实进我的档案。
const AREAS = [
  ['desk', t('展开的卡片')],   // 稿子里叫「工作区」，界面上他要这四个字（2026-09-03）
  ['pursue', t('项目争取')],
  ['people', t('人际管理')],
  ['profile', t('我的档案')],
  // 办完的事有自己的一页（2026-08-20）：心安做成 pull 不做成 push ——
  // 「它自己发现办到了」在这儿一行行躺着，不来敲你。
  // key 仍叫 ledger：改 key 等于作废地址栏白名单和你存过的链接，
  // 而这只是换个名字。2026-08-23 从「流水」改叫「时间线」——
  // 里头分成日历（你动的手）和流水（不是你动的手）两半。
  ['ledger', t('时间线')],
]

// 页面隔多久重新问一次「现在是什么样」。跟 brain 那一轮同拍（server.js 的
// MAIL_MS：收信 → 过转移表 → 判一批），它判完，页面下一拍就看得见。
// 快过它没意义（库里没新东西），慢过它就是让人盯着一个过期的世界。
const FACTS_MS = 5 * 60 * 1000

// 日期一律走 lib/when.js —— 全 app 只有那一份，按你住的地方算。
export default function App() {
  const [lib, setLib] = useState(null)
  // 档案页右边那个对话抽屉开着没有。Library 自己管开关，这儿只要知道「开着」——
  // 好让顶栏跟机会卡的抽屉一样让出位置。
  const [studioOpen, setStudioOpen] = useState(false)
  const [pl, setPl] = useState(null)
  const [tk, setTk] = useState(null)
  // 人这一层。名片 + 他名下的往来 —— 人际管理页和过卡队列都靠它。
  const [ct, setCt] = useState(null)
  // 关于你自己的事实。卡片、详情页、档案页都要用，所以走 context 而不是一路当 prop 传。
  const [profile, setProfile] = useState(PROFILE_FALLBACK)
  // view **只表示某个区旁边开着的抽屉**（线 / 人 / 机构三种），{name:'home'} = 没开。
  // 桌上（工作区）看哪张不归它管，由 queue.at 说了算。
  const [view, setView] = useState({ name: 'home' })
  const [area, setArea] = useState('pursue')
  const mods = useModules()
  // 落在关着的区(比如刷新时 URL 带 ?a=people 而机会线关着)→ 回我的档案
  useEffect(() => { if (!allowedAreas(mods).includes(area)) setArea('profile') }, [mods.pursuits, area])
  const [tasksOpen, setTasksOpen] = useState(false)
  // 机会池 = 他那张 Excel。开着才拉 —— 82 行带 notes，不该跟着看板每次刷。
  const [poolOpen, setPoolOpen] = useState(false)
  const [pool, setPool] = useState(null)
  // 批量操作：你勾出来的那一批。换区不清空 —— 换一下就无声无息没了，
  // 那是「看不见 = 丢了」的近亲。
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  // 通讯录那一页「新联系人」那一格开没开。
  const [addOpen, setAddOpen] = useState(false)
  // 桌子。存 localStorage，不上库（见 lib/queue.js 开头）。
  const [queue, setQueue] = useState(loadQueue)
  // 桌上每格的名字从这三份里对（lib/desk.js）。数据没到就是空数组，格子照样在。
  const deskData = { pursuits: pl?.pursuits || [], contacts: ct?.contacts || [], orgs: ct?.orgs || [] }
  const [sayOpen, setSayOpen] = useState(false)
  const [saying, setSaying] = useState(null)              // {i, n} | null
  const [sayFailed, setSayFailed] = useState(0)           // 群发挂了几条，也归 Trouble 说
  // 展示模式：给客户看屏幕时，名字、邮箱这些私人信息盖上小花（见 lib/veil.js）。
  // 开关就是右上角你的名字——它自己也是私人信息，开着的时候连它一起盖。
  // 公开版没有展示模式:浏览器里存过的开关一律不认,不然按钮去掉之后花花摘不下来(2026-09-24 他撞到的)
  const [veiled, setVeiled] = useState(() => (DB_MODE === 'local' ? false : loadVeiled()))
  const toggleVeil = () => setVeiled((v) => { saveVeiled(!v); return !v })

  // 进队的判据是「现在需要你」，不是「库里多了行数据」。
  // 第一次真跑就吃过亏：提了个 8-12 才要做的事，8-6 就吵人。
  //   ① 对方来信（addedIn）——你自己发的信被收录不惊动你，你知道你发过
  //   ② 有话跟你说——待办被作废；提案只有现在就能动的（无日期或到了）才算
  // （原来还有一条「行动时间到了」，撤了；那两个筛选开关 2026-09-02 也撤了——不用）
  const needsMe = (out) => {
    if (out.addedIn > 0 || out.voided) return true
    if (!out.proposed) return false
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return !out.touch || new Date(out.touch + 'T00:00:00') <= today
  }

  // 「更新最新信息」那个按钮和它背后的 runRefresh 都删了。
  //
  // 它按线逐条跑老路（拉这条线登记过的 thread）。可 62 条线一条都没登记，
  // 于是它跑 65 次、62 次返回「没处可收」，**而真正该做的事——去 Gmail
  // 收新信——它一次都没做**。8/11 那批信就是这么在库外躺了七个小时的。
  //
  // 收信现在在 brain 里每 5 分钟自己跑（mail/loop.js）。取代按钮的不是
  // 「没有反馈」，是顶栏那句一直在的实话：上次收到什么、脑子开没开。

  // 群发：同一句话分别说给每条线 / 每个人，各答各的。
  //
  // 串行，一条十几秒——跟 runRefresh 一个节奏。答完的当场进队，先到先过。
  // 批次标识用一个时间戳串：同一批的每条消息带同一个 batch，将来要认出
  // 「这几条是一次群发」也认得出来。
  //
  // 勾中的是 key（'pursuit:xxx' / 'contact:xxx'）不是裸 id —— 一批里
  // 现在可能既有线又有人（2026-08-21），光看 id 分不出该发给谁。
  const runSay = async (text) => {
    if (saying) return
    const keys = [...picked]
    if (!keys.length) return
    setSayOpen(false)
    cancelPick()
    setSayFailed(0)
    const batch = new Date().toISOString()
    const meta = { broadcast: { batch, count: keys.length } }
    let failed = 0
    for (let i = 0; i < keys.length; i++) {
      setSaying({ i: i + 1, n: keys.length })
      const owner = parseKey(keys[i])
      try {
        await sendMessage(owner, text, meta)
        setQueue((q) => enqueue(q, [{ ...owner, via: 'say' }]))
      } catch (_) {
        failed++
      }
    }
    setSaying(null)
    setSayFailed(failed)
    const r = await loadPursuits()
    if (r) setPl(r)
    // 说给人的那些落在他名片的往来里，看板刷不出来 —— 名片那一层也得重读
    if (keys.some((k) => parseKey(k).kind === 'contact')) reloadContacts()
  }

  // 这一行必须待在这儿（状态旁边），不能挪到组件下半截去。
  // 下面那个 Esc 的 useEffect 会用它，而那个 effect 在「载入中」的早退 return
  // **上面**——定义写在早退下面的话，数据还没到时按 Esc 就是 TDZ 报错。
  const cancelPick = () => { setPicking(false); setPicked(new Set()) }
  // null = 还没测出来（先别报警，免得刚打开页面就闪一下红）
  const [brain, setBrain] = useState(null)
  const restoredRef = useRef(false)
  // 顶栏那颗「展开的卡片」——飞入动画的落点（lib/fly.js）。
  // 必须待在这儿（状态旁边）：下半截在「载入中」的早退 return 下面，
  // hook 写在那儿会让两次渲染的 hook 数量对不上。
  const deskBtnRef = useRef(null)
  // 这一轮已经自动摆进「展开的卡片」的线（见 lib/desk.js 的 autoOpen）。
  // 用 ref 不用 state：它只是「别重复摆」的记性，变了不该引起重画。
  const autoOpened = useRef(new Set())
  const migratedRef = useRef(false)

  // 顶栏有多高。通讯录抽屉从它的下沿开始（见 .ppl-drawer 的 top），所以得有这个数。
  //
  // 不写死一个 55px：.app-top 是 flex-wrap 的，窗口一窄就折成两行——
  // 写死了要么露出一条缝，要么把折下来的那行压在抽屉底下。量出来的才一直是对的。
  // 用 state 存节点而不是 useRef：header 在「载入中」那次渲染里还不存在，
  // useRef + [] 的 effect 只会在 null 上跑一次，数据到了也不会再挂上去。
  const [topEl, setTopEl] = useState(null)
  useEffect(() => {
    if (!topEl) return
    const wrap = topEl.parentElement
    const ro = new ResizeObserver(() => wrap?.style.setProperty('--top-h', `${topEl.offsetHeight}px`))
    ro.observe(topEl)          // observe 自己会先量一次，不用手动补第一下
    return () => ro.disconnect()
  }, [topEl])

  // 「读到这儿了」写进库（0030 的 pursuit_seen）。跟卡走，不跟浏览器走。
  //
  // 先就地把 unread 关掉再写库：小红点该在你点开的那一瞬间灭，不该等一趟网络。
  // 写失败也不回滚——最坏是下一次真数据进来时把它带回来，比卡在那儿转圈强。
  //
  // **没红点就一个字都不写。** 不只是省一次往返：pursuit_seen 也拨脉搏（0111），
  // 「正看着的这张随时算已看」那个 effect 又跟着 pl 跑——无条件写的话就成了
  // 写 → 脉搏 → 重拉 pl → 再写 的自激循环，脉搏跳多快它烧多快。
  // 红点真亮着才有「已看」这件事可记。
  //
  // 从来没点开过的卡（seen_at 是 null，封面挂着「新」）也写一次：写完 seen_at
  // 就不是 null 了，同一张不会再触发，自激那条路还是断的。
  const markSeen = (id) => {
    const hit = pl?.pursuits?.find((p) => p.id === id)
    if (!hit || !(hit.unread || hit.seen_at === null)) return
    const at = new Date().toISOString()
    setPl((cur) => {
      if (!cur) return cur
      return { ...cur, pursuits: cur.pursuits.map((p) => (p.id === id ? { ...p, unread: false, seen_at: p.seen_at ?? at } : p)) }
    })
    markSeenDb(id).catch(() => {})
  }

  // 人卡的「已看」（0124）。跟机会线那份一个道理：先就地把红点关掉再写库，
  // 红点该在你点开的那一瞬间灭，不该等一趟网络。没红点就一个字都不写。
  const markContactSeen = (id) => {
    const hit = ct?.contacts?.find((c) => c.id === id)
    if (!hit || !hit.unread) return
    setCt((cur) => (cur ? { ...cur, contacts: cur.contacts.map((c) => (c.id === id ? { ...c, unread: false } : c)) } : cur))
    markContactSeenDb(id).catch(() => {})
  }

  const reloadContacts = () => loadContacts().then(setCt)

  useEffect(() => {
    loadLibrary().then(setLib)
    loadPursuits().then(setPl)
    loadTasks().then(setTk)
    loadPool().then(setPool)
    loadProfile().then((p) => {
      setProfile(p)
      // 日期按**你住的地方**算，不按服务器（UTC）也不按浏览器。
      // 档案里没写就退回洛杉矶（location 里第一个）。
      setTz(p?.data?.tz || 'America/Los_Angeles')
    })
    loadContacts().then(setCt)
  }, [])

  // 从这儿复制走的东西，不该把这儿的皮肤也带走 —— 粘进 Gmail 不该是一块纸色底。
  // 挂在 document 上而不是某个组件里：对话、草稿、卷宗，凡是你会拿去粘的地方
  // 都该一视同仁，一处漏了你就得记住「哪儿能直接粘、哪儿要先清格式」。
  // 捕获阶段（第三个参数 true）：冒泡阶段挂的话，中间任何一层
  // stopPropagation 都能让它落空，而那种失败是静默的——底色照样回来，
  // 看起来像这个修复根本没写过。捕获阶段在所有人之前，谁也拦不住。
  useEffect(() => {
    document.addEventListener('copy', cleanCopy, true)
    return () => document.removeEventListener('copy', cleanCopy, true)
  }, [])

  useEffect(() => { saveQueue(queue) }, [queue])

  // ── 有话没读到的，自己摆到「展开的卡片」里 ────────────────────
  //
  // 小红点说的是「Fairwind 说了话，你还没读到」。那正是今天该弄的事，
  // 不该等你去看板上一列一列找它。所以它自己摆进那一排（判据和这一摞的
  // 挑选规则在 lib/desk.js 的 autoOpen）。
  // **不换你正看着的那格**（enqueue 不动 at）：手上的位置不许被别的东西挪走。
  // 读了红点自己灭（markSeen）；按 × 关掉的这一轮不会再自己回来。
  useEffect(() => {
    if (!pl) return
    const add = autoOpen(pl.pursuits, autoOpened.current, ct?.contacts)
    if (!add.length) return
    for (const e of add) autoOpened.current.add(e.id)
    setQueue((q) => enqueue(q, add))
  }, [pl, ct])

  // ── 顶栏那个 🔔 ────────────────────────────────────────────────
  //
  // 条目一条不存，每次现算（见 lib/notifications.js）。你在邮箱里回了一封信，
  // 下一次拉的时候那条自己就没了 —— 不需要谁去「勾掉」。
  const [notes, setNotes] = useState(null)
  const [bellOpen, setBellOpen] = useState(false)
  const [judging, setJudging] = useState(false)

  const pullNotes = async () => {
    const out = await loadNotifications()
    setNotes(out)
    return out
  }
  // 开机先把旧的 localStorage['pa_cue_off'] 迁进库，再拉。
  // **升级前关掉的那些不许悄悄复活** —— 那是「你以为处理过了，其实系统忘了」。
  useEffect(() => { migrateCueOff().then(pullNotes) }, [])

  // ── 一个页面只有一个「现在」（2026-09-02，他撞上的）──────────────
  //
  // 真事：左边流水已经写着「关掉一个等待 · 工作坊提案 · Descanso Gardens ·
  // Francesca 定在 9/9」，右边通知栏还在喊「等了 4 天没等到 —— 该催了」。
  // 两句话都不假，只是**隔了半天**：通知栏是开机拉的那份 v_pa_state，
  // 时间线是你翻到这一页时才拉的 pa_ledger。
  //
  // 病根不在判断，在**页面上有两个不同的「现在」**：brain 每 5 分钟在后台
  // 收信、过转移表、判一批（server.js 的 mailLoop），判完库里两边都变了，
  // 可页面只有时间线会再去拿。开着不刷新，通知栏就一直是几个钟头前的世界。
  //
  // 所以现在两边同一个钟：后台判完一轮（同 5 分钟），页面跟着拿一次；
  // 切回这个标签页立刻拿一次 —— 合上电脑那几个钟头，回来第一眼就得是真的。
  // 拉的是四条纯 SQL（v_pa_state / cue_facts / verdicts / 未归户），不动模型，
  // 一分钱不花。判到一半（judging）时不插队，免得把手上那批的结果盖掉。
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const beat = () => setTick((n) => n + 1)
    const onBack = () => { if (document.visibilityState === 'visible') beat() }
    const iv = setInterval(beat, FACTS_MS)
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('focus', onBack)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onBack)
      window.removeEventListener('focus', onBack)
    }
  }, [])
  // 背景那一拍**只许换上真数据**：拉失败（断网、限额）时 loadNotifications
  // 返回的是一份空的（source='empty'），照单收下就等于一次网络抖动把整块
  // 「今天要做的」抹平 —— 那是「看不见 = 丢了」。你自己按的那几个口子照旧
  // 收下失败结果（该说拉不下来就得说），背景心跳不许。
  useEffect(() => {
    if (!tick || judging) return
    let alive = true
    loadNotifications().then((out) => {
      if (alive && out?.source === 'live') setNotes(out)
    })
    return () => { alive = false }
  }, [tick])

  // 抽屉宽度：上次拉成什么样，开机就摆成什么样
  useEffect(() => { restoreDrawerWidth() }, [])

  // 打开面板只读，**不判**。
  //
  // 原来是「打开才判一批」，理由写的是不看就不花钱。可那个理由是拿一次性的
  // 98 个积压算的 —— 稳态一天 1–8 个对象变脏，一天不到两毛钱。
  //
  // 而懒算有个结构性的洞：**🔔 上那个数字是在重判之前算的**。一封新信进来，
  // needs_reply 还没判、缺省当「要回」，数字 +1 —— 那封信要是「谢谢，回头见」，
  // 这个 +1 是假的，而你正是靠这个数字决定要不要打开。
  //
  // 现在收信循环每轮判一批（brain 的 judgePass），打开时该判的多半已经判完了。
  const openBell = async () => {
    setBellOpen(true)
    if (!notes) await pullNotes()
  }

  // 「接着判」：积压还没化开的时候手动催一把。
  // 走的是跟收信循环同一条路（brain 的 rejudgeThese / triageThese）。
  const judgeMore = async () => {
    setJudging(true)
    try {
      let out = notes
      if (out?.stale?.length) { await rejudge(out.stale.slice(0, REJUDGE_BATCH)); out = await pullNotes() }
      else if (out?.unjudged?.length) { await triage(out.unjudged.slice(0, 20)); await pullNotes() }
    } finally { setJudging(false) }
  }

  // 【已处理】= 记一笔（进时间线，留痕迹），不是把提醒抹掉。
  const handleNote = async (it) => {
    try { await markHandled(it) } catch (e) { console.warn('已处理没记上：', e.message) }
    await pullNotes()
  }
  // 改一条等待的到点日（「说好周四再催」这类结论的落笔口）
  const rescheduleNote = async (it, due) => {
    try { await rescheduleWait(it, due) } catch (e) { console.warn('改期没成：', e.message) }
    await pullNotes()
  }

  // 看板气泡审计视图：开着时每张卡头顶吊着它的状态。
  const [audit, setAudit] = useState(false)

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
  // 跟着 pl 走（脉搏一动就刷），所以你读着的时候进来的新回复也算读过了。
  // 桌上正看着的那格若是条线，同样算已看。
  const deskAt = area === 'desk' && queue.at ? parseKey(queue.at) : null
  const seenId = view.name === 'pursuit' ? view.pursuit?.id
    : deskAt?.kind === 'pursuit' ? deskAt.id : null
  useEffect(() => {
    if (seenId) markSeen(seenId)
  }, [seenId, pl])
  // 人那半同理（0124）：正看着的那张名片，随时算已看。
  const seenContactId = view.name === 'person' ? view.person?.id
    : deskAt?.kind === 'contact' ? deskAt.id : null
  useEffect(() => {
    if (seenContactId) markContactSeen(seenContactId)
  }, [seenContactId, ct])

  // 看板跟着计数器刷——Fairwind 在后台想完的回复、别处的改动都会自动进来，
  // 不用你手动刷新。原来是每 8 秒硬拉一遍全表（161 KB），一天好几个 GB
  // 全花在「重拉没变的东西」上；现在每 4 秒只问 v_pa_pulse 那几个数，
  // 而且**只认 board 那一列**——判个邮箱地址、写条邮件标签日志都不会惊动看板。
  // 见 docs/specs/2026-08-21-egress-diet.md。
  useEffect(() => onPulse('board', () => {
    loadPursuits().then((r) => { if (r) setPl(r) })
  }), [])

  // ── 地址栏 ⇄ 你在哪 ──────────────────────────────────────
  //
  // 两个方向：进来时按地址恢复，之后每次换页把地址改掉。
  // 在这之前只有「整页机会线」写过 ?p=，别的一律不写，于是**刷新一下
  // 不管你在哪都弹回首页**——你刚才在做的事就这么没了。
  // 手上的位置也是信息，跟队列、跟卡一样不许静静消失。

  // ① 进来时恢复。只做一次。
  //    带 d=1 的是抽屉：要等对应那份数据到了才开得成（?p= 要 pl，?c=/?o= 要 ct）。
  //    不带 d 的在桌上：不用等——桌子只记 {kind,id}，名字到了自己会对上；
  //    那张若不在桌上，先放上桌再选中。地址是你带来的，不许弹回首页。
  useEffect(() => {
    if (restoredRef.current) return
    const { area: a, card } = fromUrl()
    const done = () => { restoredRef.current = true }
    if (!card) { if (a) setArea(a); done(); return }

    if (!card.drawer) {
      done()
      setArea('desk')
      const kind = card.kind === 'org' ? 'org' : card.kind
      setQueue((q) => queueSelect(enqueue(q, [{ kind, id: card.id, via: 'pick' }]), qKey(kind, card.id)))
      return
    }
    if (card.kind === 'pursuit') {
      if (!pl) return
      const p = pl.pursuits.find((x) => x.id === card.id)
      // 找不到也得收手 —— 卡被删了/换了库，不能让它一直等下去，
      // 那会让「恢复」永远悬着，之后你换页地址栏也不跟着动。
      if (p) { done(); setArea('pursue'); markSeen(p.id); setView({ name: 'pursuit', pursuit: p, mode: 'drawer' }) }
      else if (pl.pursuits.length) done()
    } else if (card.kind === 'contact') {
      if (!ct) return
      const c = ct.contacts.find((x) => x.id === card.id)
      if (c) { done(); setArea('people'); setView({ name: 'person', person: c, mode: 'drawer' }) }
      else if (ct.contacts.length) done()
    } else {
      if (!ct) return
      const o = ct.orgs.find((x) => x.org === card.id)
      if (o) { done(); setArea('people'); setView({ name: 'org', org: o, mode: 'drawer' }) }
      else if (ct.orgs.length) done()
    }
  }, [pl, ct])

  // ② 之后每次换页把地址改掉。**恢复完成之前一个字都不写**——
  //    不然首帧那个 {name:'home'} 会把你带进来的 ?c= 当场抹掉，
  //    然后第①步就再也找不到要恢复什么了。
  //    桌上那张由 queue.at 说了算，所以工作区里写的是 deskView 不是 view。
  useEffect(() => {
    if (!restoredRef.current) return
    const cur = area === 'desk' ? deskView(queue, deskData) : view
    const next = toUrl(area, cur)
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next)
    }
  }, [area, view, queue, pl, ct])

  // ③ 标签页叫什么 = 这个标签页里看的是什么。
  //
  //   架子    Fairwind · Producer / PR / 我的档案 / 时间线（跟着主区走）
  //   桌上    Fairwind · 这条线的名字 / 这个人的名字 / 这家机构；空桌叫「工作区」
  // 名字取 pl/ct 里最新那一份：改完标题、改完名字，标签上那行也得跟着变。
  //
  // **抽屉不改名**：抽屉是「看板旁边多开的一块地方」，看板还在，你还在
  // 一张接一张地看——这个标签页装的仍然是看板。改成某条线的名字，等于
  // 说这一张标签页现在归那条线了，而下一秒你就点开了另一张。
  useEffect(() => {
    let what
    const cur = area === 'desk' ? deskView(queue, deskData) : { name: 'home' }
    if (cur.name === 'pursuit') {
      what = cur.pursuit.title
    } else if (cur.name === 'person') {
      // 展示模式下浏览器标签也不许挂人名——页面盖了、标签栏露着等于没盖。
      what = veiled ? t('联系人') : cur.person.name || t('未具名联系人')
    } else if (cur.name === 'org') {
      what = veiled ? t('机构') : cur.org.org
    } else {
      what = area === 'desk' ? t('展开的卡片') : area === 'people' ? 'PR' : area === 'profile' ? t('我的档案') : area === 'ledger' ? t('时间线') : 'Producer'
    }
    document.title = 'Fairwind · ' + what
  }, [area, queue, pl, ct, veiled])

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
      else if (poolOpen) setPoolOpen(false)
      else if (tasksOpen) setTasksOpen(false)
      // Esc 是关抽屉最顺手的动作，所以它得跟点「收起」做一样的事——
      // 也标已看、也把 ?p= 从地址栏抹掉。原来它只换了 view，小红点会赖着不走。
      else if (view.name !== 'home') closeDrawer()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tasksOpen, poolOpen, view, picking])

  if (!lib || !pl || !tk) return <div className="wrap"><div className="loading">{t('载入中……')}</div></div>

  // 哪个 loader 先出的问题就报哪个——机会线优先，那是主战场。
  const fellBack = pl.reason || lib.reason || tk.reason || null
  const fellBackDetail = pl.reason ? pl.detail : lib.reason ? lib.detail : tk.detail
  // 点卡片 / 点人 / 点机构：右边划出抽屉，底下的看板 / 通讯录留着——大多数时候
  // 你只是想看一眼，看完接着看下一张。整页只在工作区里有。
  const openPursuit = (p) => setView({ name: 'pursuit', pursuit: p, mode: 'drawer' })
  const openPerson = (c) => setView({ name: 'person', person: c, mode: 'drawer' })
  const openOrg = (o) => setView({ name: 'org', org: o, mode: 'drawer' })
  const closeDrawer = () => {
    if (view.name === 'pursuit') markSeen(view.pursuit.id)
    setView({ name: 'home' })          // 地址栏归上面那个同步 effect 管
  }
  // 你离开期间 Fairwind 说了话、你还没读到的卡。判据在库里算（0030 的 v_pa_pursuits.unread）：
  // 最后一条是 Fairwind 说的、不是建卡那份 brief、且晚于你上次读这条线。
  // 对方来信不直接点红点——收信时 Fairwind 会补一句告知，由那句来点。
  // 当前正开着的那张不算。
  const unseen = new Set(
    pl.pursuits
      .filter((p) => p.unread && p.id !== seenId)
      .map((p) => p.id)
  )
  // 同一件事换个说法：那一排卡片上要按 key 认（线和人混在一排里）。
  const unreadKeys = new Set([
    ...[...unseen].map((id) => qKey('pursuit', id)),
    // 人那半（0124）。库还没升级时 unread 是 undefined —— 那就一颗红点都不点，
    // 不假装知道。
    ...(ct?.contacts || []).filter((c) => c.unread && c.id !== seenContactId).map((c) => qKey('contact', c.id)),
  ])

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
      alert(t('移动没保存：') + e.message)
    }
  }

  // 勾掉「下一步」。做完一件事该立刻看见它被划掉，所以先动界面再写库。
  //   action —— 只写完成时间戳，next_action 原文留着（详情页仍看得见，也能取消勾）
  //   touch  —— 记下今天碰过了，把待碰日清掉。这个没有撤销。

  // 卡上随手记的几个字。写失败要把原文还回去——你刚打的字不能因为网络就没了。
  const jotCard = async (p, jot) => {
    const prev = pl.pursuits
    setPl({ ...pl, pursuits: prev.map((x) => (x.id === p.id ? { ...x, jot: jot || null } : x)) })
    try {
      await setJot(p.id, jot)
    } catch (e) {
      setPl({ ...pl, pursuits: prev })
      alert(t('这一笔没记上：') + e.message + t('\n\n你写的是：') + jot)
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
      alert(t('球权没保存：') + e.message)
    }
  }

  // 勾的是 key（'pursuit:xxx' / 'contact:xxx'），不是裸 id —— 看板勾的是线、
  // 🔔 里可能勾到人，一摞里两种都有，光凭 id 到了群发那步分不出该发给谁。
  const pick = (keys, on) => setPicked((s) => {
    const next = new Set(s)
    for (const k of keys) on ? next.add(k) : next.delete(k)
    return next
  })

  // ── 桌子 ────────────────────────────────────────────────────
  // 队列（lib/queue.js）就是工作区的桌子。这儿只做三件事：放上去 / 拿下来 / 看哪格。
  const onDeskKey = (k) => Boolean(k) && inQueue(queue, k)
  // 抽屉头上那颗开关。**留在原地**——它是「记下今天要弄它」，不是「带我去」。
  // 按下去三处当场翻面（这颗、顶栏数字、卡角上的记号），你看得见东西去了哪。
  // 放上去的那一下再多一件事：一个带卡名的小标签从按钮飞到顶栏那个字上（lib/fly.js）——
  // 跟购物车一样，你看得见它去了哪。拿回来不飞：收回去没有「去了哪」可讲。
  // （ref 的定义在上面状态区：这儿在「载入中」那次早退 return **下面**，
  //   写在这儿的 hook 数据到了才执行，前后两次渲染 hook 数量对不上，整页白。）
  // 抽屉头上那颗按钮按下去。两种意思，看它现在是哪一面（见 DeskToggle）：
  //   没展开 → 摆进去，人留在原地，一个带卡名的小标签飞到顶栏那个字上（lib/fly.js）
  //   已展开 → 带你过去看它。**不是拿走**：拿走只有 × 一个出口。
  const deskPress = (kind, id, fromEl, label) => {
    const k = qKey(kind, id)
    if (inQueue(queue, k)) {
      setQueue((q) => queueSelect(q, k))
      closeDrawer()
      setArea('desk')
      return
    }
    setQueue((q) => enqueue(q, [{ kind, id, via: 'pick' }]))
    flyTo(fromEl, deskBtnRef.current, label)
  }
  // 从桌上某一页点相关的人 / 线：直接开成旁边一格，切过去。
  const openOnDesk = (kind, id) => {
    setQueue((q) => queueSelect(enqueue(q, [{ kind, id, via: 'pick' }]), qKey(kind, id)))
    setArea('desk')
  }
  const drawerKey = view.name === 'pursuit' ? qKey('pursuit', view.pursuit.id)
    : view.name === 'person' ? qKey('contact', view.person.id)
    : view.name === 'org' ? qKey('org', view.org.org) : null

  // 过一遍：勾的几张一起放上桌，然后过去——这颗按钮说的就是「开始过这一摞」。
  const pickAll = () => {
    const entries = [...picked].map((k) => ({ ...parseKey(k), via: 'pick' }))
    if (!entries.length) return
    setQueue(queueSelect(enqueue(queue, entries), keyOf(entries[0])))
    cancelPick()
    // 面板让位：你已经说了「开始过这一摞」，它还盖在卡片上就成了挡路的。
    setBellOpen(false)
    setArea('desk')
  }

  // 抽屉只在两个架子旁边开：看板旁、通讯录旁。桌上没有抽屉。
  // App 自己那个抽屉（机会卡 / 名片 / 机构）开没开。
  const drawered = (area === 'pursue' || area === 'people') && view.name !== 'home'
  // 顶栏要不要让位。档案页那个抽屉是 Library 自己挂的（摊开一条才出来），
  // 它也盖在右沿，🔔 一样得让。**跟上面分开算**：混成一个的话，档案页一开抽屉
  // App 就以为自己也该开一个，去读一个不存在的机构，整页崩掉（真崩过一次）。
  const yielding = drawered || (area === 'profile' && studioOpen)
  // 打开的那条线，永远取 pl 里最新的那一份。
  // view.pursuit 是**你点开那一刻的快照**——乐观更新和轮询都只动 pl，不动它，
  // 所以照着快照渲染的话，你在抽屉里点「认了」，看板上的记号消失了、抽屉里那个还在。
  // 找不到（还没读回来）就退回快照，卡不能因此空掉。
  const openedPursuit = view.name === 'pursuit'
    ? (pl.pursuits.find((x) => x.id === view.pursuit.id) || view.pursuit)
    : null
  const deskSet = new Set(queue.items.map(keyOf))
  // 名片同理：改完一格要立刻显示新值，所以永远取 ct 里最新那一份。
  const openedPerson = view.name === 'person'
    ? (ct?.contacts?.find((x) => x.id === view.person.id) || view.person)
    : null

  return (
   <ProfileContext.Provider value={profile}>
   <VeilContext.Provider value={veiled}>
    <div className={'wrap' + (yielding ? ' drawered' : '')}>
      <header className="app-top" ref={setTopEl}>
        <div className="brand"><Mark /><span className="name">Fairwind</span></div>
        <nav className="areas" aria-label={t('主区')}>
          {AREAS.filter(([key]) => allowedAreas(mods).includes(key)).map(([key, label]) => (
            <button
              key={key}
              ref={key === 'desk' ? deskBtnRef : undefined}
              className={'area' + (area === key ? ' on' : '')}
              onClick={() => { setArea(key); if (view.name !== 'home') closeDrawer() }}
            >
              {label}
              {/* 桌上几张。空着不挂数——「· 0」是占位，占位就是骗人。 */}
              {key === 'desk' && queue.items.length > 0 && <span className="area-n"> · {queue.items.length}</span>}
            </button>
          ))}
        </nav>
        <span className="sp" />
        {/* 收信状态和 🔔 从二级带子搬上来（2026-09-02）：它们是全局的事，
            不归哪个区管，所以住在唯一一条永远在的带子上。
            🔔 的数字**只数该动的**（2026-08-20 他拍的）：等待和没归线的在面板里
            各自带着数，但不上角标 —— 角标是「现在有几件事等你动」，
            不是「系统里躺着多少条」。 */}
        {mods.mail && <MailState state={brain?.mail} />}
        {mods.pursuits && <button className="bellbtn" onClick={openBell} aria-label={t('该动的')}>
          {/* Lucide 的 bell，跟读书 app（阅读陪伴）同一套手写内联 SVG 的规格：
              24 视口、stroke=currentColor、1.75、圆头圆角，不引库。 */}
          <svg className="bellic" viewBox="0 0 24 24" width="17" height="17" fill="none"
               stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
               strokeLinejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>{(notes?.due?.length || 0) > 0 && (
            <span className="belln">{notes.due.length}</span>
          )}
        </button>}
        {/* 右上角你的名字 = 展示模式的开关。给客户看屏幕之前点一下，
            页面上的名字、邮箱全换成小花；再点一下摘掉。
            开着的时候这颗按钮自己也得盖——你的名字同样是私人信息，
            而且它正好当场演示了「盖住」长什么样。 */}
        {/* 有新版本:以前是一颗光秃秃的点,悬停才知道是什么(他 9/25 问「这个红点什么意思」)。
            现在直接写在设置按钮旁边,点了就进设置——版本那一行有「更新到」的按钮 */}
        {DB_MODE === 'local' ? (
          // 公开版没有展示模式(那是他给客户看屏幕用的);右上角是系统设置:装了哪些、账号、备份、更新、接 Claude Code
          <button className={'veilbtn' + (area === 'settings' ? ' on' : '')} onClick={() => { setArea('settings'); if (view.name !== 'home') closeDrawer() }} title={t('系统设置')}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 5, verticalAlign: -3 }}>
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />
            </svg>{t('设置')}{brain?.update?.canUpdate && <span className="upd-pill">{t('新版本 {v}', { v: brain.update.latest })}</span>}
          </button>
        ) : (
        <button className={'veilbtn' + (veiled ? ' on' : '')} onClick={toggleVeil}
                title={veiled ? t('展示模式开着：私人信息都盖着小花。点一下摘掉。')
                              : t('展示模式：给客户看屏幕前点一下，名字、邮箱盖上小花。')}>
          {veiled ? <><Flower size={14} /><span>{t('展示中')}</span></> : (profile?.name || t('我'))}
        </button>
        )}
      </header>

      {/* 批量操作开着时，面板里的条目也是勾选目标 —— 勾的是同一摞 picked：
          看板按阶段摆，面板按到点没到点摆，同一批卡换个取景框勾。 */}
      {mods.pursuits && bellOpen && (
        <Notifications
          data={notes} mail={brain?.mail} judging={judging} onJudgeMore={judgeMore}
          picking={picking} picked={picked} onPick={pick}
          onHandled={handleNote}
          onReschedule={rescheduleNote}
          auditOn={audit}
          /* 气泡现在名片上也挂（2026-08-23），所以人在人际管理页时别把他拽走 ——
             拽走等于「你要看的那一页刚好不给看」。其余情况仍然带去看板：
             那句话的意思就是「挂到看板上」。 */
          onAudit={() => { setAudit((x) => !x); setBellOpen(false)
                           setArea((a) => (a === 'people' ? a : 'pursue')) }}
          onGoPeople={() => { setBellOpen(false); setArea('people') }}
          onClose={() => setBellOpen(false)}
          onOpen={(it) => {
            setBellOpen(false)
            if (it.subject_kind === 'pursuit') {
              const p = pl.pursuits.find((x) => x.id === it.subject_id)
              if (p) { setArea('pursue'); openPursuit(p) }
            } else {
              const c = ct?.contacts?.find((x) => x.id === it.subject_id)
              if (c) { setArea('people'); openPerson(c) }
            }
          }}
        />
      )}

      {/* 一切正常时这里什么都不渲染 */}
      <Trouble
        fellBack={fellBack}
        detail={fellBackDetail}
        brainDown={brain ? !brain.up : false}
        brainStale={brain ? brain.stale : false}
        batchFailed={sayFailed}
        mail={mods.mail ? brain?.mail : null}
      />

      {/* ── 工作区底下那一排：桌上开着的窗口 ──
          **只在工作区亮着时有**。别的区底下没有第二排：放在「项目争取」底下的一排，
          任何人都会当成它的分栏，可它混着人。位置在说一件事、内容在说另一件事，
          就是要教才会用的界面。空桌连带子都不画——一条空带子是占位，占位就是骗人。 */}
      {area === 'desk' && queue.items.length > 0 && (
        <DeskTabs tabs={deskTabs(queue, deskData)} at={queue.at} unread={unreadKeys}
                  onPick={(k) => setQueue((q) => queueSelect(q, k))}
                  onClose={(k) => setQueue((q) => queueDone(q, k))} />
      )}

      {area === 'desk' ? (
        (() => {
          const cur = deskView(queue, deskData)
          if (!queue.items.length) return <div className="desk-empty">{t('没有展开的卡片。去看板或通讯录挑，抽屉头上按「展开」。')}</div>
          if (cur.name === 'home') return <div className="desk-empty">{t('这一格对应的东西找不到了——库里没有它。关掉它就行。')}</div>
          if (cur.name === 'pursuit') return (
            <PursuitFocus brainUp={brain ? brain.up : true}
              // key：换一条线就换一个实例。不加的话 React 复用同一个，thinking / text /
              // 在飞的请求会跨卡片留着——你在 A 卡问完立刻点开 B 卡，B 卡会凭空转起点点，
              // 而 A 的回复回来时还会塞进你正看着的 B 卡里。
              key={cur.pursuit.id} variant="page" pursuit={cur.pursuit}
              messages={pl.messagesByPursuit[cur.pursuit.id]}
              /* 从一条线上点相关的人 → 开成旁边一格。两边本来是断的：
                 线上看得到往来，却点不进那个人是谁。 */
              onOpenPerson={(c) => openOnDesk('contact', c.id)}
              onBack={() => setArea('pursue')} onMove={moveCard} onSetBall={markBall} />
          )
          if (cur.name === 'person') return (
            <PersonFocus brainUp={brain ? brain.up : true} key={cur.person.id} person={cur.person} variant="page"
              onBack={() => setArea('people')} onChanged={reloadContacts}
              onOpenPursuit={(id) => openOnDesk('pursuit', id)} />
          )
          return (
            <OrgFocus key={cur.org.org} org={cur.org} variant="page"
              onBack={() => setArea('people')}
              onOpenPerson={(id) => openOnDesk('contact', id)}
              onOpenPursuit={(id) => openOnDesk('pursuit', id)} />
          )
        })()
      ) : area === 'people' ? (
        <>
          {/* 通讯录自己的头一行：动作跟着它作用的东西走。
              「批量操作」跟看板共用同一摞 picked，所以人和线可以混着勾（见 lib/queue.js 的 qKey）。 */}
          <PickBar picking={picking} pickedCount={picked.size} saying={saying}
                   onStart={() => setPicking(true)} onCancel={cancelPick}
                   onSay={() => setSayOpen(true)} onPickAll={pickAll}>
            <button className="wbtn" onClick={() => setAddOpen(true)}>
              {t('＋ 新联系人')}{ct?.groups?.length ? t(' · {n} 伙人等着收', { n: ct.groups.length }) : ''}
            </button>
          </PickBar>
          <People
            contacts={ct?.contacts || []}
            orgs={ct?.orgs || []}
            strangers={ct?.strangers || []}
            groups={ct?.groups || []}
            fellBack={ct?.reason || null}
            /* 2026-09-02：点人 / 点机构跟看板点卡片一样，先出抽屉，看一眼就走。
               原来是原地换页——线和人两套规矩就得教。⌘/Ctrl+点新开标签页那条路
               也撤了：地址栏还在，要并排看复制地址就行，那是浏览器自己的规矩。 */
            onOpen={openPerson}
            onOpenOrg={openOrg}
            onAdded={reloadContacts}
            addOpen={addOpen}
            onCloseAdd={() => setAddOpen(false)}
            picking={picking} picked={picked} onPick={pick}
            desk={deskSet}
            /* 气泡跟看板同一套：这个人现在卡在什么上，吊在名片头顶。
               states 是同一份 v_pa_state —— 线和人 2026-08-21 就不分家了。 */
            audit={audit}
            states={new Map([...(notes?.due || []), ...(notes?.waiting || [])].map((x) => [x.subject_id, x]))}
          />
        </>
      ) : area === 'settings' ? (
        <SettingsPage />
      ) : area === 'profile' ? (
        <Library entries={lib.entries} concerns={lib.concerns}
                 onProfileSaved={() => loadProfile().then(setProfile)}
                 onEntrySaved={() => loadLibrary().then(setLib)}
                 onDrawerChange={setStudioOpen} />
      ) : area === 'ledger' ? (
        <Timeline
          /* 待办从这儿来：跟 🔔 同一份 v_pa_state，不另查一遍 */
          states={[...(notes?.due || []), ...(notes?.waiting || [])]}
          /* 流水跟通知栏同一个钟 —— 两半必须是同一个时刻的 */
          tick={tick}
          onOpen={(r) => {
          if (r.subject_kind === 'pursuit') {
            const p = pl.pursuits.find((x) => x.id === r.subject_id)
            if (p) { setArea('pursue'); openPursuit(p) }
          } else {
            const c = ct?.contacts?.find((x) => x.id === r.subject_id)
            if (c) { setArea('people'); openPerson(c) }
          }
        }} />
      ) : (
        <>
          {/* 看板自己的头一行：「造卡任务」「批量操作」。
              原来在导航带子上，还带着「待处理 / 紧急」两个镜头——镜头撤了（不用），
              动作跟着看板走。 */}
          <PickBar picking={picking} pickedCount={picked.size} saying={saying}
                   onStart={() => setPicking(true)} onCancel={cancelPick}
                   onSay={() => setSayOpen(true)} onPickAll={pickAll}>
            <button className="wbtn" onClick={() => setPoolOpen(true)}>
              {t('机会池')}{pool?.rows?.length ? ` · ${pool.rows.length}` : ''}
            </button>
            <button className="wbtn" onClick={() => setTasksOpen(true)}>{t('造卡任务')}</button>
          </PickBar>
          {/* 原来这儿有条「今天需要你的」横幅，只认「一起写」那一列。撤了：
              「今天该做什么」不该由某一列决定。以后要做这种提示，得有自己的依据，
              不能挂在某个列名上——否则用户一改列，提示就跟着错。 */}
          <Pipeline pursuits={pl.pursuits} tasks={tk.tasks}
            states={new Map([...(notes?.due || []), ...(notes?.waiting || [])].map((x) => [x.subject_id, x]))}
            audit={audit}
            onOpen={openPursuit} onMove={moveCard} onJot={jotCard} unseen={unseen} picking={picking} picked={picked} onPick={pick}
            desk={deskSet} />
          {/* 气泡视图开着时，一颗悬浮的关闭钮 —— 你是从 🔔 里进来的，
              但收起不该非得再打开 🔔 */}
          {audit && (
            <button className="audit-off" onClick={() => setAudit(false)}>{t('收起气泡')}</button>
          )}
        </>
      )}

      {/* ── 抽屉：看板旁、通讯录旁共用一份 ──
          不加遮罩：抽屉开着的时候底下必须还能点，你要的就是一张接一张地看。
          aside 而不是 dialog——它不挡着你操作，就是旁边多开的一块地方。
          头上那颗「展开」是开关：按了人留在原地，三处翻面。 */}
      {drawered && (
        <aside className="drawer" aria-label={view.name === 'pursuit' ? view.pursuit.title : view.name === 'person' ? t('名片') : view.org.org}>
          {/* 左沿那条可以拉的边 —— 33vw 是个猜的数，屏幕不一样合适的宽度也不一样 */}
          <DrawerGrip />
          {view.name === 'pursuit' ? (
            <PursuitFocus brainUp={brain ? brain.up : true} key={view.pursuit.id} variant="drawer" pursuit={openedPursuit}
              messages={pl.messagesByPursuit[view.pursuit.id]}
              onOpenPerson={(c) => { setArea('people'); openPerson(c) }}
              onBack={closeDrawer} onMove={moveCard} onSetBall={markBall}
              onDesk={onDeskKey(drawerKey)} onToggleDesk={(el) => deskPress('pursuit', view.pursuit.id, el, openedPursuit.title)} />
          ) : view.name === 'person' ? (
            <PersonFocus brainUp={brain ? brain.up : true} key={view.person.id} variant="drawer" person={openedPerson}
              onBack={closeDrawer} onChanged={reloadContacts}
              onOpenPursuit={(id) => { const p = pl.pursuits.find((x) => x.id === id); if (p) { setArea('pursue'); openPursuit(p) } }}
              onDesk={onDeskKey(drawerKey)} onToggleDesk={(el) => deskPress('contact', view.person.id, el, veiled ? t('联系人') : openedPerson.name)} />
          ) : (
            <OrgFocus key={view.org.org} variant="drawer" org={ct?.orgs?.find((o) => o.org === view.org.org) || view.org}
              onBack={closeDrawer}
              onOpenPerson={(id) => { const c = ct?.contacts?.find((x) => x.id === id); if (c) openPerson(c) }}
              onOpenPursuit={(id) => { const p = pl.pursuits.find((x) => x.id === id); if (p) { setArea('pursue'); openPursuit(p) } }}
              onDesk={onDeskKey(drawerKey)} onToggleDesk={(el) => deskPress('org', view.org.org, el, veiled ? t('机构') : view.org.org)} />
          )}
        </aside>
      )}

      {/* 一条都没勾就没有「对选中的 0 条线」这回事 —— 干脆不摆 */}
      {sayOpen && picked.size > 0 && (
        <SayTo n={picked.size} onSend={runSay} onCancel={() => setSayOpen(false)} />
      )}

      {/* 造卡任务只列属于项目争取的那些——「关系降温提醒」归人际管理 */}
      <TasksPanel tasks={tk.tasks.filter(isPursuitTask)} open={tasksOpen} onClose={() => setTasksOpen(false)}
        brain={brain} tz={profile?.data?.tz} onChanged={() => loadTasks().then(setTk)} />

      {/* 机会池：那张 Excel。它是表不是卡 —— 见 components/Opportunities.jsx 顶上那段。
          lastRun 只取战报第一行；全文在造卡任务面板里，不在这儿重复一遍。 */}
      <Opportunities
        open={poolOpen} onClose={() => setPoolOpen(false)} pool={pool}
        onChanged={() => loadPool().then(setPool)}
        lastRun={tk.tasks.find((t) => t.prompt)?.last_result?.split('\n')[1] || null} />
    </div>
   </VeilContext.Provider>
   </ProfileContext.Provider>
  )
}
