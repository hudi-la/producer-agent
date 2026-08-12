import React, { useEffect, useRef, useState } from 'react'
import { fetchMessages, sendMessage, stopThinking } from '../lib/chat.js'
import { BALL_STATES, ballOf } from '../lib/ball.js'
import { doneAction, voidedAction, actionLine } from '../lib/nextAction.js'
import {
  fetchDeliverables, fetchAttachments, setFinal, syncMail,
  uploadAttachment, attachmentUrl, deleteAttachment,
} from '../lib/deliverables.js'
import Dossier from './Dossier.jsx'
import Deliverables from './Deliverables.jsx'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { heldLabel, useProfile } from '../lib/profile.js'

// remark-breaks：单个换行就换行。标准 markdown 里单换行等于空格，
// 可 Fairwind 和 scout 写进库的东西是按行分的（「**流程**：…\n**判断**：…」），
// 不加这个插件，三行会被粘成一坨——你截图里看到的就是这个。
function Md({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{ a: (props) => <a target="_blank" rel="noreferrer" {...props} /> }}
    >
      {children || ''}
    </ReactMarkdown>
  )
}

const STAGE_LABELS = {
  pending: '新机会', matching: '匹配项目', writing: '一起写', sent: '发出&提交',
  replying: '进一步', won: '谈成', paused: '暂停处理',
}
const STAGE_ORDER = ['pending', 'matching', 'writing', 'sent', 'replying', 'won', 'paused']

const srcLabel = (s) => (s === 'manual' ? '你丢的' : 'scout')
const PAYOFF = { paid: '给钱', access: '给圈子', both: '钱 + 圈子' }

function Facts({ p }) {
  const profile = useProfile()
  const stars = p.match_stars ? '★'.repeat(p.match_stars) : null
  return (
    <div className="pfacts">
      {p.kind && <span className="pf"><i>类型</i>{p.kind}</span>}
      {p.opens_at && <span className="pf"><i>开放</i>{p.opens_at}</span>}
      {p.deadline && <span className="pf warn"><i>截止</i>{p.deadline}</span>}
      {p.org && <span className="pf"><i>机构</i>{p.org}</span>}
      {p.location && <span className="pf"><i>地点</i>{p.location}</span>}
      {p.funding && <span className="pf"><i>资助</i>{p.funding}</span>}
      {/* 从卡面撤下来的——它是决定要不要推的依据，该在这儿而不是天天占卡上一行 */}
      {p.payoff && <span className="pf"><i>回报</i>{PAYOFF[p.payoff] || p.payoff}</span>}
      {stars && <span className="pf"><i>匹配</i>{stars}</span>}
      <span className="pf"><i>来源</i>{srcLabel(p.source)}</span>
      <span className="pf"><i>主打作品</i>{p.work_title || '待定'}</span>
      {p.url && <a className="pf pf-a" href={p.url} target="_blank" rel="noreferrer"><i>链接</i>官方页面 ↗</a>}
      {!p.eligible && <span className="pf held">{heldLabel(profile)}</span>}
    </div>
  )
}

// 截止并进卡头，跟球权站一起：一个是这条线唯一的死线，一个是它唯一的开关。
// 原来截止在左边的事实堆里、球权在卡头，两个要害分在两处；而且球权还出现过两次
// （左栏那份是只读副本），人会以为是两件事。
function Deadline({ p }) {
  const raw = p.deadline_at || p.deadline
  if (!raw) return null
  // 按日历天算，不按 24 小时算。截止在明天，就该说「剩 1 天」——
  // 用毫秒差去 ceil 的话现在是下午就会说成 2 天，多给你一天不存在的余地。
  let left = null
  if (p.deadline_at) {
    const d = new Date(p.deadline_at + 'T00:00:00')
    if (!Number.isNaN(+d)) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      left = Math.round((d - today) / 86400000)
    }
  }
  const urgent = left != null && left <= 14
  return (
    <span className={'dl' + (urgent ? ' urgent' : '')}>
      <i>截止</i><b>{raw}</b>
      {left != null && <em>{left < 0 ? '已过' : left === 0 ? '今天' : `剩 ${left} 天`}</em>}
    </span>
  )
}

function Message({ m }) {
  // 备注不是谁在说话。role='note' 是这条线上的一笔记录（线下发生的事、一个决定），
  // 原来它也走「其余一律显示 Fairwind」那条路，于是你自己记的事看起来像 Fairwind 说的。
  if (m.role === 'note') {
    return (
      <div id={'msg-' + m.id} className="notecard">
        <span className="ntag">{m.kind === 'decision' ? '决定' : '备注'}</span>
        <div className="md"><Md>{m.content}</Md></div>
      </div>
    )
  }
  if (m.kind === 'brief') {
    return (
      <div className="msg-row">
        <div className="briefcard">
          <div className="byline"><span className="pdot" aria-hidden="true" /><span className="pname">Fairwind <span>· 讲懂这个机会</span></span></div>
          <div className="md"><Md>{m.content}</Md></div>
        </div>
      </div>
    )
  }
  if (m.kind === 'draft') {
    return (
      <div className="msg-row">
        <div className="draftcard">
          <div className="draft-top"><span className="pname">草稿</span><span className="lang">EN</span></div>
          <div className="draft-body md"><Md>{m.content}</Md></div>
        </div>
      </div>
    )
  }
  // 谁在说话，得说准。
  //
  // 原来只分两类：artist 显示「你」，**其余一律显示 Fairwind**。于是库里 10 封
  // role='org' 的机构来信在界面上全挂着 Fairwind 的名字——Kirk 说的、Sarah 说的、
  // CultureHub 的正式邀请，看起来都像是 Fairwind 说的。这是在骗人。
  const mine = m.role === 'artist'
  const external = m.role === 'org'
  const who = mine ? '你' : external ? (m.meta?.from_name || '对方') : 'Fairwind'
  // 群发的那句要标明是群发的。不标的话，半年后你翻回这条线看见自己说
  // 「帮我起一封信问问日程」，会以为当时专门为这家想过——其实那是一句群发。
  const bc = m.meta?.broadcast
  return (
    <div id={'msg-' + m.id} className={'msg' + (mine ? ' you' : external ? ' org' : ' producer')}>
      <span className="who">{who}{m.kind === 'email' && <span className="viamail"> · 邮件</span>}
        {bc && <span className="viamail"> · 同时发给了 {bc.count} 条线</span>}
      </span>
      <div className="bubble md"><Md>{m.content}</Md></div>
    </div>
  )
}

// 整页里，邮件在左栏卷宗，中栏只留这一条锚点。
// 它必须留——时间线上「这天来了一封信」是叙事的一部分，抽掉了对话就断了。
function MailAnchor({ m, onJump }) {
  const d = m.created_at ? new Date(m.created_at) : null
  const when = d && !Number.isNaN(+d) ? `${d.getMonth() + 1}/${d.getDate()}` : ''
  const who = m.role === 'artist' ? '你发了一封' : `${m.meta?.from_name || '对方'}来信`
  return (
    <div id={'msg-' + m.id} className="mailanchor">
      <b>{when}</b> {who}
      <button className="lnk" onClick={() => onJump?.(m.id)}>看左栏 ↖</button>
    </div>
  )
}

// 已经被搬进右栏产出的那版草稿，这儿只留一条线索。
// 不是删——原文一个字没动，还在库里，也还在右栏那份产出的正文里。
// 只是同一段话在一屏上出现两次，人会以为是两份东西。
function PromotedAnchor({ m, title }) {
  const d = m.created_at ? new Date(m.created_at) : null
  const when = d && !Number.isNaN(+d) ? `${d.getMonth() + 1}/${d.getDate()}` : ''
  return (
    <div id={'msg-' + m.id} className="mailanchor">
      <b>{when}</b> Fairwind 起了一版 → 成了右栏的《{title}》
    </div>
  )
}

function emptyText(stage) {
  // 新机会的卡本该在后台就读透了。还空着 = 脑子没开，或刚进来还没轮到。
  if (stage === 'pending') return 'Fairwind 还没读这条——脑子开着的话稍等一会儿就有了（没开就跑 npm run brain）。'
  if (stage === 'matching') return '你批准了——接下来我们一起挑用哪件作品，再往下写。'
  return '这条机会线还没有往来。我这就开始。'
}

// 两种装法，同一套内容：
//   drawer —— 从右边划出来盖在看板上，看板还在旁边，可以一张接一张点过去
//   page   —— 整页（新标签页里 ?p=<id> 打开的就是这个），留给你要长时间写东西的时候
// 现在两者装的东西一样，只差宽度。等作品链、文档、邮件单独成栏做出来，
// 整页才会长出抽屉装不下的部分。
export default function PursuitFocus({
  onOpenPerson,
  pursuit: p, messages, variant = 'page', onBack, onExpand, onMove, onSetBall,
  queue = null, onQueuePrev, onQueueNext, onQueueDone, onQueueLater, onAccept,
}) {
  const inDrawer = variant === 'drawer'
  const [msgs, setMsgs] = useState(messages || [])
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [err, setErr] = useState(null)
  const [stage, setStageLocal] = useState(p.stage)
  // 球权本地先动，写库由 App 负责回滚。装的是「球在谁那边」这个答案本身，
  // 不是「你有没有手动改过」——后者不是你要看的东西。
  const [ball, setBallLocal] = useState(ballOf(p))
  const done = doneAction(p)
  const voided = voidedAction(p)
  // 活着的待办：现在该干什么（actionLine 已经跳过作废的）。
  // 卡面一直有这行，唯独抽屉里没有——抽屉只显示做完的和作废的，
  // 于是「现在该干什么」是这儿唯一看不见的那种状态。
  const live = actionLine(p)
  // 它提的、你还没认的那句。认领挂在这句话旁边，不挂在过卡器的出口上。
  const proposed = live?.by === 'fairwind' ? live : null
  const endRef = useRef(null)
  const taRef = useRef(null)        // 输入框本体，用来按内容撑高
  const runIdRef = useRef(null)     // 正在跑的那一次，「终止」靠它找到对应的活
  // 三栏只给整页。抽屉窄，塞不下卷宗和产出，保持单栏不动。
  const threeCol = !inDrawer
  const [deliv, setDeliv] = useState([])
  const [atts, setAtts] = useState([])

  // 「在想」不能靠猜。
  //
  // 原来的判断是「最后一条是你发的 = 它欠你一条回复」，于是只要有一次没想完
  // （脑子崩了 / 超时 / 你关了页面），那条线就永远显示三个点——而且输入框跟着
  // 永久禁用，你连再说一遍都做不到，整条线就此锁死。三个点是猜的，不是真有东西在跑。
  //
  // 现在：只有「刚发出去、还在合理等待窗口内」才算在想。超过这个窗口就承认
  // 它没回，把输入框还给你。另外限定 kind='message'——你发给机构的真实邮件
  // （role='artist', kind='email'）不是在跟 Fairwind 说话，不该触发「在想」。
  // 你按过终止的那条：别再等它的回复了，回复不会来了。
  // 不写这个的话，终止完输入框还得按上面那个 3 分钟窗口干等——你正是急着改字才按的停。
  const [stoppedId, setStoppedId] = useState(null)
  const STALE_MS = 3 * 60 * 1000   // 联网研究最久见过 30–60 秒，3 分钟还没回就是死了
  const lastMsg = msgs.length ? msgs[msgs.length - 1] : null
  const awaiting = !!lastMsg && lastMsg.role === 'artist' && (lastMsg.kind || 'message') === 'message'
    && lastMsg.id !== stoppedId
  const waitedMs = awaiting && lastMsg.created_at
    ? Date.now() - new Date(lastMsg.created_at).getTime()
    : 0   // 乐观插入的临时消息还没有 created_at，当作刚发出
  const busy = thinking || (awaiting && waitedMs < STALE_MS)
  const stalled = awaiting && !thinking && waitedMs >= STALE_MS

  // 换一条线：先用手上的，再从库里拉最新（别的地方写进来的卡也能看见）。
  // 「讲懂」不在这儿触发了——脑子在后台把新机会的卡先读好，你点开时它已经在库里。
  useEffect(() => {
    let alive = true
    setMsgs(messages || [])
    setStageLocal(p.stage)
    setBallLocal(ballOf(p))
    setErr(null)
    fetchMessages(p.id).then((rows) => {
      if (alive && rows) setMsgs(rows)
    })
    return () => { alive = false }
  }, [p.id])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs.length, thinking])

  // 输入框按内容撑高。必须先归零再量 scrollHeight——不归零的话 scrollHeight
  // 永远不小于当前高度，删字的时候框只会长不会缩。上限在 CSS 的 max-height，
  // 到顶了 textarea 自己滚。
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [text])

  // 产出和附件。只有整页要，抽屉不拉——省一次往返。
  async function reloadDeliv() {
    if (!threeCol) return
    const [d, a] = await Promise.all([fetchDeliverables(p.id), fetchAttachments(p.id)])
    if (d) setDeliv(d)
    if (a) setAtts(a)
  }
  useEffect(() => {
    setDeliv([]); setAtts([]); setSyncNote(null)
    reloadDeliv()
    const iv = setInterval(reloadDeliv, 5000)
    return () => clearInterval(iv)
  }, [p.id, threeCol])

  // 收信。失败要说出来——不说的话你会以为「没新信」，其实是同步断了。

  // 取消定稿：左栏那份退回右栏接着改。改的还是同一份，不生第二个版本。
  async function unfinal(id) {
    try { await setFinal(id, false); await reloadDeliv() } catch (e) { setErr(e.message) }
  }

  // ── 卡上的文件 ────────────────────────────────────────────────
  // 传完立刻重拉一次，不做乐观更新：这儿的「成功」是两步（字节 + 登记），
  // 乐观更新就得自己编一行假的，编出来的那行跟库里对不上就是在骗自己。
  async function addFile(file) {
    await uploadAttachment(p.id, file)
    await reloadDeliv()
  }

  // 私有桶，每次现拿一条 60 秒的签名链接。新标签页打开，不下载——
  // PDF 直接在浏览器里看就行，不用先落到你的下载文件夹里。
  async function openFile(a) {
    try {
      if (!a.storage_key) throw new Error('这份只有登记没有字节（多半是早年的空行）')
      window.open(await attachmentUrl(a.storage_key), '_blank', 'noopener')
    } catch (e) {
      setErr(e.message)
    }
  }

  async function dropFile(a) {
    try { await deleteAttachment(a.id); await reloadDeliv() } catch (e) { setErr(e.message) }
  }

  // 两个方向的跳：产出/卷宗 → 中栏那一句；中栏的锚点 → 左栏那封信
  function flashTo(domId) {
    const el = document.getElementById(domId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('flash')
    setTimeout(() => el.classList.remove('flash'), 1600)
  }
  const jumpTo = (msgId) => flashTo('msg-' + msgId)
  const jumpMail = (msgId) => flashTo('dmail-' + msgId)

  // 实时兜底：开着这条线时每 3 秒拉一次库。 Fairwind 在后台想完的回复会自动出现——
  // 你不必守着这个页面。离开再回来也一样，因为回复本就落在库里，不在你的屏幕上。
  useEffect(() => {
    const iv = setInterval(async () => {
      const rows = await fetchMessages(p.id)
      if (!rows) return
      setMsgs((cur) => {
        const tmp = cur.filter((m) =>
          typeof m.id === 'string' && m.id.startsWith('tmp') &&
          !rows.some((r) => r.role === m.role && r.content === m.content))
        const next = [...rows, ...tmp]
        if (next.length === cur.length && next[next.length - 1]?.id === cur[cur.length - 1]?.id) return cur
        return next
      })
    }, 3000)
    return () => clearInterval(iv)
  }, [p.id])

  async function send() {
    const t = text.trim()
    if (!t || busy) return
    setText('')
    setErr(null)
    setThinking(true)
    // run_id 在这儿生成，跟着请求一起发过去——不能等回来再拿：
    // /chat 是想完了才返回的，那时候早没得停了。
    const runId = crypto.randomUUID()
    runIdRef.current = runId
    const tmp = { id: 'tmp-' + Date.now(), role: 'artist', kind: 'message', content: t }
    setMsgs((m) => [...m, tmp])
    try {
      const { mine, reply, aborted } = await sendMessage(p.id, t, undefined, runId)
      // 终止了就只留你那条：它没写回复，reply 是 null。
      setMsgs((m) => [...m.filter((x) => x.id !== tmp.id), mine, ...(reply ? [reply] : [])])
      if (aborted) setStoppedId(mine.id)
    } catch (e) {
      // 脑子是先存你的话、再去想的，所以失败有两种：
      //   连不上 → 一个字都没存 → 把内容还回输入框，别让你白打
      //   存了但想崩了 → 话已经在库里 → 不能还，还了你再发一次就重了
      const rows = await fetchMessages(p.id)
      const landed = rows?.some((m) => m.role === 'artist' && m.content === t)
      if (rows) setMsgs(rows)
      else setMsgs((m) => m.filter((x) => x.id !== tmp.id))
      if (!landed) {
        setText((cur) => cur || t)   // 期间你要是又打了别的，就别覆盖
        setErr(e.message + '（你的话还在框里，没丢）')
      } else {
        setErr(e.message + '（你的话存下了，Fairwind 没想完 —— 再说一次让它重想）')
      }
    } finally {
      setThinking(false)
      runIdRef.current = null
    }
  }

  // 终止：掐掉正在跑的那一次，不写回复。你说的那句留着——它是你说的话，不是它想的。
  //
  // 拿不到 run_id 也照样把界面解开：可能是脑子重启过、或者这条「在想」是上次
  // 开着页面时留下的。那种情况下本来也没东西在跑，卡着输入框没有意义。
  async function stop() {
    const rid = runIdRef.current
    if (lastMsg) setStoppedId(lastMsg.id)
    setThinking(false)
    runIdRef.current = null
    if (rid) await stopThinking(rid)
  }

  // 哪些消息已经被搬进右栏当产出了（deliverables.source_msg 指着它）
  const promotedFrom = new Map(
    deliv.filter((d) => d.source_msg).map((d) => [d.source_msg, d.title])
  )

  // 「这次发生了什么」：更新最新信息把这张卡送进队，先交代它动了什么再让你过。
  // 内容全部从库里读（最新的信、作废行、它提的那句）——队列只存 id 和 via，
  // 不背内容：背了的那份不会跟着库变，迟早说谎。
  const viaUpdate = queue?.via === 'update'
  const lastMail = viaUpdate ? [...msgs].reverse().find((m) => m.kind === 'email') : null
  const proposal = viaUpdate ? live : null
  const mailWhen = (m) => {
    const d = m?.created_at ? new Date(m.created_at) : null
    return d && !Number.isNaN(+d) ? `${d.getMonth() + 1}/${d.getDate()}` : ''
  }

  // 中栏那一整块：往来时间线 + 输入框。三栏和抽屉装的是同一份内容，
  // 只是三栏把它塞进中间那格，抽屉直接铺满。
  const body = (
    <>
      <div className="focus-scroll">
        <div className="focus-inner">
          <div className="fh">
            {/* 整页时事实搬去了左栏卷宗，这儿不再重复一遍；抽屉没有卷宗，照旧显示 */}
            {!threeCol && <Facts p={p} />}
            {/* 勾掉的待办不从卡面消失就完事——这条线上你做过什么，得留得住。 */}
            {done && <p className="pf-done">✓ {done.text} <span>· {done.at}完成</span></p>}
            {/* 被新信作废的待办：划掉留痕，说得出因为哪封信、点得回去。不是它凭空没了。 */}
            {voided && (
              <p className="pf-void">✗ <s>{voided.text}</s> <span>· {voided.at}作废</span>
                {voided.byMsg && <button className="lnk" onClick={() => jumpTo(voided.byMsg)}>因为这封信 →</button>}
              </p>
            )}
            {p.last_touch_at && <p className="pf-done">✓ 已碰过 <span>· {p.last_touch_at}</span></p>}
            {/* why / notes 库里存的就是 markdown（带加粗、按行分段），
                原来直接当纯文本塞进 <p>，所以星号露在外面、几行被压成一坨。 */}
            {p.why && <div className="pf-why md"><Md>{p.why}</Md></div>}
            {p.notes && <div className="pf-notes md"><Md>{p.notes}</Md></div>}
          </div>

          {msgs.length === 0 && !busy ? (
            <div className="empty-thread">{emptyText(p.stage)}</div>
          ) : (
            <div className="thread">
              {/* 整页里邮件不进这条流——它在左栏卷宗。这儿只留一条极轻的锚点，
                  点它跳到左边那封。信一封不少，只是待在它该待的地方。 */}
              {msgs.map((m, i) => {
                if (threeCol && m.kind === 'email') {
                  return <MailAnchor m={m} key={m.id || i} onJump={jumpMail} />
                }
                const promoted = threeCol && promotedFrom.get(m.id)
                if (promoted) return <PromotedAnchor m={m} title={promoted} key={m.id || i} />
                return <Message m={m} key={m.id || i} />
              })}
              {/* 没在想、又确实欠着一条回复——说实话，别拿三个点糊弄过去 */}
              {stalled && (
                <div className="stalled">
                  Fairwind 没回这条（多半是当时脑子没开，或者那次想崩了）。
                  <b>再说一次就行</b>——它带着这条线的全部往来，你不用重讲。
                </div>
              )}
              {busy && (
                <div className="msg producer">
                  <span className="who">Fairwind</span>
                  <div className="bubble thinking"><i /><i /><i /></div>
                </div>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {err && <div className="composer-err">{err}</div>}
      <div className="composer">
        {/* textarea 而不是 input：一行装不下就自己长高（上限在 CSS 的 max-height，
            到顶了才开始滚）。Enter 发送，Shift+Enter 换行。
            isComposing 那句不能删——中文输入法选词时也会敲 Enter，
            不挡的话你选个词就把半句话发出去了。 */}
        <textarea
          ref={taRef}
          className="ph"
          rows={1}
          value={text}
          disabled={busy}
          placeholder={busy ? 'Fairwind 在想……（想完会自动出现，你不用守着）' : '一起想点什么…… Fairwind 带着这条线的全部往来，你不用重讲'}
          onChange={(e) => { setText(e.target.value); if (err) setErr(null) }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            send()
          }}
        />
        {busy ? (
          <button className="send stop" aria-label="终止" title="终止——停掉 Fairwind 这次的回复" onClick={stop}>
            <svg width="15" height="15" viewBox="0 0 16 16"><rect x="4.5" y="4.5" width="7" height="7" rx="1.4" fill="#fff" /></svg>
          </button>
        ) : (
          <button className="send" aria-label="发送" onClick={send} disabled={!text.trim()}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M8 3 4.5 6.5M8 3l3.5 3.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
      </div>
    </>
  )

  return (
    <div className={'focus ' + variant}>
      {/* 标题在顶条里，跟着一起钉住——你往下读对话时，「这是哪条线」不该滚走。
          整页一行放得下就一行，放不下截断；抽屉窄，最多两行。 */}
      <div className="focus-top">
        {/* 队头。翻页什么都不改——翻回来那张原样在那儿，所以 ‹ › 旁边
            没有任何「已处理」的标记，只有位置。
            两个出口也在这排——原来在抽屉底部，跟输入框叠在一起被盖住了；
            而且「过没过完这张」跟「在队里第几张」本来就是同一件事的两半。 */}
        {queue && (
          <div className="qnav">
            <button className="qarrow" onClick={onQueuePrev} disabled={queue.i <= 0} aria-label="上一张">‹</button>
            <span className="qcount">{queue.i + 1} / {queue.n}</span>
            <button className="qarrow" onClick={onQueueNext} disabled={queue.i >= queue.n - 1} aria-label="下一张">›</button>
            <span className="qsp" />
            {/* 「移出」就一个意思：这张从这一摞里拿走，卡里什么都不碰。
                它不说「这件事我干完了」——干没干完看内容（草稿定没定稿、待办勾没勾、信回没回）。
                想先放着 = 翻页 ‹ › 走过去、或关掉抽屉——它下次还在原位。 */}
            <button className="wbtn" onClick={onQueueDone}>移出</button>
          </div>
        )}

        {/* 你为什么在队里。
            一张卡进了队却说不出为什么，正是这两刀一直在治的病——所以
            「更新最新信息送来的」要交代，你自己端上来的（via='pick'/'say'）不用：
            那是你亲手放的，不用它讲给你听。
            **必须钉在卡头里，不能待在对话流上方**：打开卡片时那个自动滚到底的
            effect 会把它滚到可视区外 680px 处——东西在，但你永远看不见。
            跟两个出口挪上来是同一个理由。 */}
        {queue && viaUpdate && (lastMail || voided || proposal?.by === 'fairwind') && (
          <div className="qwhat">
            {lastMail && (
              <span>有新信 · {mailWhen(lastMail)} {lastMail.role === 'artist' ? '你发的' : (lastMail.meta?.from_name || '对方')}
                <button className="lnk" onClick={() => jumpTo(lastMail.id)}>看最近这封 →</button>
              </span>
            )}
            {voided && <span>作废了 · <s>{voided.text}</s></span>}
            {proposal?.by === 'fairwind' && <span>它提了 · {proposal.text}</span>}
          </div>
        )}

        {/* 现在该干什么。跟队头、两个出口、「这次发生了什么」一样钉在卡头里：
            放进对话流上方的话，打开卡片时那个自动滚到底的 effect 会把它滚走。
            「它提的」记号和「认了」贴在这句话自己旁边——认领是对**这句话**表态，
            跟「这张卡还在不在我手头」无关，所以它不在过卡器的出口上。 */}
        {live && (
          <div className={'pf-live' + (live.urgent ? ' urgent' : '')}>
            <span className="pf-live-t">{live.text}</span>
            {proposed && (
              <>
                <span className="pc-by">它提的</span>
                <button className="lnk" onClick={() => onAccept?.(p.id)}>认了</button>
              </>
            )}
          </div>
        )}

        <div className="ft-head">
          {inDrawer ? (
            <button className="back" onClick={onBack} aria-label="收起" title="收起"><span aria-hidden="true">✕</span><span className="t"> 收起</span></button>
          ) : (
            <button className="back" onClick={onBack}><span aria-hidden="true">←</span> 全部机会线</button>
          )}
          <h1 className="ft-title" title={p.title}>{p.title}</h1>
          {inDrawer && (
            <button className="expand" onClick={() => onExpand?.(p)} title="在新标签页里整页打开">
              整页 <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
        <div className="ft-ctl">
        {/* 截止跟球权站一起：一个是这条线唯一的死线，一个是它唯一的开关 */}
        <Deadline p={p} />
        {/* 球在谁那边。Fairwind 自己贴一个，贴错了直接改掉——没有「谁来判断」这个选项。
            两个都不亮 = 还没有依据（既没往来也没跟进日），你可以自己定一个。 */}
        <div className="ballsw" role="group" aria-label="球在谁那边">
          {BALL_STATES.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={'bsw ' + v + (ball === v ? ' on' : '')}
              aria-pressed={ball === v}
              onClick={() => { if (ball === v) return; setBallLocal(v); onSetBall?.(p.id, v) }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="stg-lbl">阶段
          <select
            className="stg-sel"
            value={stage}
            onChange={(e) => { setStageLocal(e.target.value); onMove?.(p.id, e.target.value) }}
          >
            {STAGE_ORDER.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
        </label>
        </div>
      </div>

      {threeCol ? (
        <div className="focus-cols">
          <aside className="fc-l">
            <Dossier
              p={p}
              msgs={msgs}
              files={deliv.filter((d) => d.status === 'final')}
              attachments={atts}
              onUnfinal={unfinal}
              onJump={jumpTo}
              onUpload={addFile}
              onOpenFile={openFile}
              onDeleteFile={dropFile}
              onOpenPerson={onOpenPerson}
            />
          </aside>
          <div className="fc-m">{body}</div>
          <aside className="fc-r">
            <Deliverables
              pursuitId={p.id}
              items={deliv}
              files={deliv.filter((d) => d.status === 'final')}
              onChanged={reloadDeliv}
              onJump={jumpTo}
            />
          </aside>
        </div>
      ) : body}
    </div>
  )
}
