import React, { useEffect, useRef, useState } from 'react'
import { fetchMessages, sendMessage } from '../lib/chat.js'
import { BALL_LABEL } from '../lib/ball.js'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function Md({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
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

function Facts({ p }) {
  const stars = p.match_stars ? '★'.repeat(p.match_stars) : null
  return (
    <div className="pfacts">
      {p.kind && <span className="pf"><i>类型</i>{p.kind}</span>}
      {p.deadline && <span className="pf warn"><i>截止</i>{p.deadline}</span>}
      {p.org && <span className="pf"><i>机构</i>{p.org}</span>}
      {p.location && <span className="pf"><i>地点</i>{p.location}</span>}
      {p.funding && <span className="pf"><i>资助</i>{p.funding}</span>}
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

export default function PursuitFocus({ pursuit: p, messages, onBack, onMove, onSetBall }) {
  const [msgs, setMsgs] = useState(messages || [])
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [err, setErr] = useState(null)
  const [stage, setStageLocal] = useState(p.stage)
  // 手动球权本地先动，写库由 App 负责回滚。null = 交还给自动判断。
  const [ball, setBallLocal] = useState(p.ball ?? null)
  const endRef = useRef(null)

  // 「 Fairwind 在想」从消息推导：最后一条是你发的 = Fairwind 还欠你一条回复。
  // 这样即使你离开再回来，也照样显示在想——状态不靠本地内存的临时 flag。
  const lastIsArtist = msgs.length > 0 && msgs[msgs.length - 1].role === 'artist'
  const busy = thinking || lastIsArtist

  // 换一条线：先用手上的，再从库里拉最新（别的地方写进来的卡也能看见）。
  // 「讲懂」不在这儿触发了——脑子在后台把待批准的卡先读好，你点开时它已经在库里。
  useEffect(() => {
    let alive = true
    setMsgs(messages || [])
    setStageLocal(p.stage)
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

  return (
    <div className="focus">
      <div className="focus-top">
        <button className="back" onClick={onBack}><span aria-hidden="true">←</span> 全部机会线</button>
        <span style={{ flex: 1 }} />
        {/* 球在谁那边。默认自动（看最后是谁说的话 / 跟进日到没到），觉得判错了就手动钉住。 */}
        <div className="ballsw" role="group" aria-label="球在谁那边">
          {[[null, '自动'], ['me', '待处理'], ['them', '等回复']].map(([v, label]) => (
            <button
              key={label}
              type="button"
              className={'bsw' + (ball === v ? ' on' : '') + (v ? ' ' + v : '')}
              onClick={() => { setBallLocal(v); onSetBall?.(p.id, v) }}
            >
              {label}
              {v === null && !ball && p.ball_auto && (
                <span className="bsw-auto">（{BALL_LABEL[p.ball_auto]}）</span>
              )}
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
      <div className="focus-scroll">
        <div className="focus-inner">
          <div className="fh">
            <h1>{p.title}</h1>
            <Facts p={p} />
            {p.why && <p className="pf-why">{p.why}</p>}
            {p.notes && <p className="pf-notes">{p.notes}</p>}
          </div>

          {msgs.length === 0 && !busy ? (
            <div className="empty-thread">{emptyText(p.stage)}</div>
          ) : (
            <div className="thread">
              {msgs.map((m, i) => <Message m={m} key={m.id || i} />)}
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
