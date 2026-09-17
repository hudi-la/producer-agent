import React, { useEffect, useRef } from 'react'
import { useChat } from '../lib/useChat.js'
import { fetchStudioThread, rewindStudio } from '../lib/studio.js'
import SayBubble from './Resay.jsx'
import Md from './Md.jsx'

// 右边那一栏：左边摊开哪一条，这儿就是那一条的对话。**一条一个**，
// 各记各的，永久累积。放在旁边而不是塞进条目里，是为了改描述时
// 原文和商量在同一屏上对着看。
//
// 说话那一整套（发、边想边出字、重说、终止）走 useChat —— 跟机会线那页
// 用的是同一份实现，不是照抄的第二份。这儿只剩渲染。
//
// 这一条上的 Fairwind **一个字都写不进库**：它写的每段话都是给你看的稿子，
// 进不进档案是你自己选中、复制、在上面那一格里改。所以这儿没有信卡、
// 没有表卡、没有状态卡 —— 它没有那些能力。

export default function EntryChat({ entry }) {
  const chat = useChat({
    owner: { kind: 'studio', id: entry.id },
    reload: () => fetchStudioThread(entry.id),
    rewind: rewindStudio,
  })
  const { msgs, setMsgs, text, setText, busy, err, setErr, editId, setEditId, live, act } = chat
  const endRef = useRef(null)

  useEffect(() => {
    let alive = true
    setMsgs([])
    setErr(null)
    fetchStudioThread(entry.id).then((rows) => { if (alive) setMsgs(rows || []) })
    return () => { alive = false }
  }, [entry.id, setMsgs, setErr])

  useEffect(() => {
    if (msgs.length || live) endRef.current?.scrollIntoView({ block: 'end' })
  }, [msgs.length, live, busy])

  return (
    <div className="echat">
      <div className="echat-hd">
        一起写《{entry.title || '未命名'}》
        <i>它带着你整个档案，但这次只说这一条。
          写出来的字进不了档案——你自己复制到左边那一格里。</i>
      </div>

      <div className="echat-thread">
        {msgs.length === 0 && !busy && (
          <div className="empty-thread">
            这段描述哪儿不准？想把它写成什么样？<br />
            它说的每段话都是稿子，你挑要的那段复制到左边。
          </div>
        )}
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
                  onResay={chat.resay}
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
        <div ref={endRef} />
      </div>

      {err && <div className="echat-err">{err}</div>}
      <div className="echat-composer">
        {/* isComposing 那句不能删——中文输入法选词时也会敲 Enter，
            不挡的话你选个词就把半句话发出去了。 */}
        <textarea
          rows={1}
          value={text}
          disabled={busy}
          placeholder={busy ? '在想……（想完会自动出现，你不用守着）'
            : '这段描述哪儿不准？想把它写成什么样？'}
          onChange={(e) => { setText(e.target.value); if (err) setErr(null) }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            chat.send()
          }}
        />
        {busy ? (
          <button className="stop" onClick={chat.stop}>停</button>
        ) : (
          <button onClick={() => chat.send()} disabled={!text.trim()}>说</button>
        )}
      </div>
    </div>
  )
}
