import React, { useCallback, useEffect, useRef, useState } from 'react'
import { sendMessageStream, stopThinking } from '../lib/chat.js'
import { fetchStudioThread, rewindStudio } from '../lib/studio.js'
import { useLiveReply } from '../lib/useLiveReply.js'
import { dropFrom } from '../lib/rewind.js'
import SayBubble from './Resay.jsx'
import Md from './Md.jsx'

// 档案里那张书桌（0127）。每一栏右边一条专属对话，各记各的，永久累积。
//
// 这儿的 Fairwind **一个字都写不进库**：它写的每段话都是给他看的稿子，
// 进不进档案是他自己选中、复制、在那一格里改。所以这个组件比机会线那边
// 干净得多——没有信卡、没有表卡、没有状态卡，因为它没有那些能力。
//
// ── 为什么没跟 PursuitFocus 共用一个 Message ────────────────────
//
// 那边的 Message 背着一整套机会线专有的东西：信卡、申请表卡、拨提醒的卡、
// 记忆卡、邮件、跳左栏的锚点、讲懂、草稿、备注。这张桌子一样都不需要。
// 抽成共用的话，得给那个组件加十来个「不传就不画」的 prop，两头都变难读。
//
// 真正共用的那几块本来就已经是独立文件了：SayBubble（重说那个气泡）、
// Md（markdown）、dropFrom（撤的规则）、useLiveReply（边想边出字）。
// 而长相的唯一真相在 styles.css 里那几个类名（.msg / .bubble / .who），
// 两边用的是同一套——所以「改出两种气泡」这件事结构上发生不了。

export default function StudioChat({ section, focus }) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(true)
  const { live, act, onEvent: onLive, reset: resetLive } = useLiveReply()
  const runIdRef = useRef(null)
  const endRef = useRef(null)
  const taRef = useRef(null)

  // 换一栏 = 换一条对话。上一栏那条留在库里，回来还在。
  useEffect(() => {
    let alive = true
    setLoading(true)
    setMsgs([])
    setErr(null)
    setEditId(null)
    fetchStudioThread(section).then((rows) => {
      if (!alive) return
      setMsgs(rows || [])
      setLoading(false)
    })
    return () => { alive = false }
  }, [section])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [msgs.length, live, busy])

  const send = useCallback(async (said) => {
    const t = (said ?? text).trim()
    if (!t || busy) return
    if (said == null) setText('')
    setErr(null)
    setBusy(true)
    // run_id 在这儿生成、跟着请求一起发过去——不能等回来再拿：
    // 想完了才返回，那时候早没得停了。
    const runId = crypto.randomUUID()
    runIdRef.current = runId
    const tmp = { id: 'tmp-' + Date.now(), role: 'artist', kind: 'message', content: t }
    setMsgs((m) => [...m, tmp])
    let landedMine = null
    try {
      const { mine, reply, aborted } = await sendMessageStream(
        { kind: 'studio', id: section }, t, undefined, runId,
        (e) => {
          if (e.t === 'mine') {
            landedMine = e.row
            setMsgs((m) => m.map((x) => (x.id === tmp.id ? e.row : x)))
          } else {
            onLive(e)
          }
        },
        // 「他现在开着哪一栏、展开着哪几条」。每一句都带上——他随时会展开另一条，
        // 而它得知道下一句说的是哪一件。
        focus,
      )
      const you = mine || landedMine
      setMsgs((m) => [
        ...m.filter((x) => x.id !== tmp.id && x.id !== you?.id),
        ...(you ? [you] : []),
        ...(reply ? [reply] : []),
      ])
      if (aborted) setErr(null)
    } catch (e) {
      // 脑子是先存你的话、再去想的，所以失败有两种：
      //   连不上 → 一个字都没存 → 把内容还回输入框，别让你白打
      //   存了但想崩了 → 话已经在库里 → 不能还，还了再发一次就重了
      const rows = await fetchStudioThread(section)
      const landed = rows?.some((m) => m.role === 'artist' && m.content === t)
      if (rows) setMsgs(rows)
      else setMsgs((m) => m.filter((x) => x.id !== tmp.id))
      if (!landed) {
        setText((cur) => cur || t)
        setErr(e.message + '（你的话还在框里，没丢）')
      } else {
        setErr(e.message + '（你的话存下了，它没想完——再说一次让它重想）')
      }
    } finally {
      setBusy(false)
      resetLive()
      runIdRef.current = null
    }
  }, [text, busy, section, focus, onLive, resetLive])

  /**
   * 重说：撤掉这句和它之后的对话，然后把改完的这句照常发出去。
   *
   * 顺序不能反。先撤再发，它拿到的是干净的往来；先发再撤，
   * 它已经带着那句错话想过一轮了——而那正是按这个按钮要躲开的事。
   */
  async function resay(id, said) {
    const t = said.trim()
    if (!t || busy) return
    setErr(null)
    try {
      await rewindStudio(id)
    } catch (e) {
      setErr('没撤成：' + e.message + '（你改的字还在，可以再按一次重说）')
      return
    }
    setEditId(null)
    setMsgs((cur) => dropFrom(cur, id))
    await send(t)
  }

  async function stop() {
    const rid = runIdRef.current
    setBusy(false)
    resetLive()
    runIdRef.current = null
    if (rid) await stopThinking(rid)
  }

  const open = focus?.open || []

  return (
    <aside className="studio" aria-label={`${focus?.label || '这一栏'}的书桌`}>
      <div className="studio-hd">
        <b>一起写</b>
        {/* 它眼前摆着什么，说出来。不说的话「它到底知不知道我在看哪条」
            只能靠猜——而猜错的代价是你以为它在说这条、它在说另一条。 */}
        <span className="studio-sub">
          {open.length
            ? `它看着你展开的 ${open.length} 条：${open.map((e) => `《${e.title}》`).join('')}`
            : `它带着你整个档案。展开哪一条，它就知道你在说哪一条。`}
        </span>
      </div>

      <div className="studio-thread">
        {loading ? null : msgs.length === 0 && !busy ? (
          <div className="empty-thread">
            这儿的话进不了档案——它写的是稿子，你自己复制过去、在那一格里改。
          </div>
        ) : (
          <div className="thread">
            {msgs.map((m, i) => {
              const mine = m.role === 'artist'
              return (
                <div id={'msg-' + m.id} key={m.id || i} className={'msg' + (mine ? ' you' : ' producer')}>
                  <span className="who">{mine ? '你' : 'Fairwind'}</span>
                  {mine ? (
                    <SayBubble
                      m={m} msgs={msgs} editing={editId === m.id}
                      /* 在想的时候不给改：那会撤掉一条它还在写的回复 */
                      disabled={busy}
                      onStart={setEditId}
                      onCancel={() => setEditId(null)}
                      onResay={resay}
                    />
                  ) : (
                    <div className="bubble md"><Md>{m.content}</Md></div>
                  )}
                </div>
              )
            })}
            {busy && (
              <div className="msg producer">
                <span className="who">Fairwind</span>
                {live ? (
                  <div className="bubble md streaming"><Md>{live}</Md></div>
                ) : (
                  <div className="bubble thinking"><i /><i /><i /></div>
                )}
                {act && !live && <span className="thinking-act">{act}</span>}
              </div>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {err && <div className="studio-err">{err}</div>}
      <div className="studio-composer">
        {/* isComposing 那句不能删——中文输入法选词时也会敲 Enter，
            不挡的话你选个词就把半句话发出去了。 */}
        <textarea
          ref={taRef}
          className="ph"
          rows={1}
          value={text}
          disabled={busy}
          placeholder={busy ? '在想……（想完会自动出现，你不用守着）'
            : '这段描述哪儿不对？想写份什么？'}
          onChange={(e) => { setText(e.target.value); if (err) setErr(null) }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            send()
          }}
        />
        {busy ? (
          <button className="stop" onClick={stop}>停</button>
        ) : (
          <button className="go" onClick={() => send()} disabled={!text.trim()}>说</button>
        )}
      </div>
    </aside>
  )
}
