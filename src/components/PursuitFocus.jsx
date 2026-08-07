import React, { useEffect, useRef, useState } from 'react'
import { fetchMessages, sendMessage } from '../lib/chat.js'
import { BALL_STATES, ballOf } from '../lib/ball.js'
import { doneAction, voidedAction, actionLine } from '../lib/nextAction.js'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

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
  pending: '待批准', matching: '匹配项目', writing: '一起写', sent: '发出&提交',
  replying: '初次回信&继续沟通', won: '谈成', paused: '暂停处理',
}
const STAGE_ORDER = ['pending', 'matching', 'writing', 'sent', 'replying', 'won', 'paused']

const srcLabel = (s) => (s === 'manual' ? '你丢的' : 'scout')
const PAYOFF = { paid: '给钱', access: '给圈子', both: '钱 + 圈子' }

function Facts({ p }) {
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
      {!p.eligible && <span className="pf held">O-1 · 资格搁置</span>}
    </div>
  )
}

function Message({ m }) {
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
  const mine = m.role === 'artist'
  return (
    <div className={'msg' + (mine ? ' you' : ' producer')}>
      <span className="who">{mine ? '你' : 'Fairwind'}</span>
      <div className="bubble md"><Md>{m.content}</Md></div>
    </div>
  )
}

function emptyText(stage) {
  // 待批准的卡本该在后台就读透了。还空着 = 脑子没开，或刚进来还没轮到。
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
  pursuit: p, messages, variant = 'page', onBack, onExpand, onMove, onSetBall,
  queue = null, onQueuePrev, onQueueNext, onQueueDone, onQueueLater,
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
  const endRef = useRef(null)

  // 「在想」不能靠猜。
  //
  // 原来的判断是「最后一条是你发的 = 它欠你一条回复」，于是只要有一次没想完
  // （脑子崩了 / 超时 / 你关了页面），那条线就永远显示三个点——而且输入框跟着
  // 永久禁用，你连再说一遍都做不到，整条线就此锁死。三个点是猜的，不是真有东西在跑。
  //
  // 现在：只有「刚发出去、还在合理等待窗口内」才算在想。超过这个窗口就承认
  // 它没回，把输入框还给你。另外限定 kind='message'——你发给机构的真实邮件
  // （role='artist', kind='email'）不是在跟 Fairwind 说话，不该触发「在想」。
  const STALE_MS = 3 * 60 * 1000   // 联网研究最久见过 30–60 秒，3 分钟还没回就是死了
  const lastMsg = msgs.length ? msgs[msgs.length - 1] : null
  const awaiting = !!lastMsg && lastMsg.role === 'artist' && (lastMsg.kind || 'message') === 'message'
  const waitedMs = awaiting && lastMsg.created_at
    ? Date.now() - new Date(lastMsg.created_at).getTime()
    : 0   // 乐观插入的临时消息还没有 created_at，当作刚发出
  const busy = thinking || (awaiting && waitedMs < STALE_MS)
  const stalled = awaiting && !thinking && waitedMs >= STALE_MS

  // 换一条线：先用手上的，再从库里拉最新（别的地方写进来的卡也能看见）。
  // 「讲懂」不在这儿触发了——脑子在后台把待批准的卡先读好，你点开时它已经在库里。
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
    const tmp = { id: 'tmp-' + Date.now(), role: 'artist', kind: 'message', content: t }
    setMsgs((m) => [...m, tmp])
    try {
      const { mine, reply } = await sendMessage(p.id, t)
      setMsgs((m) => [...m.filter((x) => x.id !== tmp.id), mine, reply])
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
    }
  }

  // 「这次发生了什么」：更新最新信息把这张卡送进队，先交代它动了什么再让你过。
  // 内容全部从库里读（最新的信、作废行、它提的那句）——队列只存 id 和 via，
  // 不背内容：背了的那份不会跟着库变，迟早说谎。
  const viaUpdate = queue?.via === 'update'
  const lastMail = viaUpdate ? [...msgs].reverse().find((m) => m.kind === 'email') : null
  const proposal = viaUpdate ? actionLine(p) : null
  const mailWhen = (m) => {
    const d = m?.created_at ? new Date(m.created_at) : null
    return d && !Number.isNaN(+d) ? `${d.getMonth() + 1}/${d.getDate()}` : ''
  }

  return (
    <div className={'focus ' + variant}>
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
            {queue.skippedAt && <span className="qskip">{queue.skippedAt} 你先放着了</span>}
            <span className="qsp" />
            {/* 只有「做完了」让顶栏那个数字降下去——「再等一等」留在队里挪队尾，它还欠着。 */}
            <button className="wbtn" onClick={onQueueDone}>做完了</button>
            <button className="btn" onClick={onQueueLater}>再等一等</button>
          </div>
        )}

        {/* 你为什么在队里。
            一张卡进了队却说不出为什么，正是这两刀一直在治的病——所以
            「到日子了」和「更新最新信息送来的」都要交代，只有你自己勾进来的
            （via='pick'）不用：那是你亲手放的，不用它讲给你听。
          **必须钉在卡头里，不能待在对话流上方**：打开卡片时那个自动滚到底的
          effect 会把它滚到可视区外 680px 处——东西在，但你永远看不见。
          跟两个出口挪上来是同一个理由。 */}
        {queue?.dueWhy && (
          <div className="qwhat">
            <span>到日子了 · {queue.dueWhy}</span>
          </div>
        )}
        {queue && viaUpdate && (lastMail || voided || proposal?.by === 'fairwind') && (
          <div className="qwhat">
            {lastMail && <span>有新信 · {mailWhen(lastMail)} {lastMail.role === 'artist' ? '你发的' : (lastMail.meta?.from_name || '对方')}</span>}
            {voided && <span>作废了 · <s>{voided.text}</s></span>}
            {proposal?.by === 'fairwind' && <span>它提了 · {proposal.text}</span>}
          </div>
        )}
        {inDrawer ? (
          <button className="back" onClick={onBack} aria-label="收起" title="收起"><span aria-hidden="true">✕</span><span className="t"> 收起</span></button>
        ) : (
          <button className="back" onClick={onBack}><span aria-hidden="true">←</span> 全部机会线</button>
        )}
        <span style={{ flex: 1 }} />
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
        {inDrawer && (
          <button className="expand" onClick={() => onExpand?.(p)} title="在新标签页里整页打开">
            整页 <span aria-hidden="true">↗</span>
          </button>
        )}
      </div>
      <div className="focus-scroll">
        <div className="focus-inner">
          <div className="fh">
            <h1>{p.title}</h1>
            <Facts p={p} />
            {/* 勾掉的待办不从卡面消失就完事——这条线上你做过什么，得留得住。 */}
            {done && <p className="pf-done">✓ {done.text} <span>· {done.at}完成</span></p>}
            {/* 被新信作废的待办：划掉留痕，说得出因为哪封信。不是它凭空没了。 */}
            {voided && (
              <p className="pf-void">✗ <s>{voided.text}</s> <span>· {voided.at}作废</span>
                {voided.byMsg && <span> · 因为这封信</span>}
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
              {msgs.map((m, i) => <Message m={m} key={m.id || i} />)}
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
        <input
          className="ph"
          value={text}
          disabled={busy}
          placeholder={busy ? 'Fairwind 在想……（想完会自动出现，你不用守着）' : '一起想点什么…… Fairwind 带着这条线的全部往来，你不用重讲'}
          onChange={(e) => { setText(e.target.value); if (err) setErr(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
        />
        <button className="send" aria-label="发送" onClick={send} disabled={busy || !text.trim()}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M8 3 4.5 6.5M8 3l3.5 3.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
  )
}
