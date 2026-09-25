import React, { useEffect, useRef } from 'react'
import { t } from '../i18n/index.js'
import { useChat } from '../lib/useChat.js'
import { useGrow } from '../lib/useGrow.js'
import { fetchStudioThread, rewindStudio, restartStudio } from '../lib/studio.js'
import SayBubble from './Resay.jsx'
import Md from './Md.jsx'

// 右边那个抽屉：左边摊开哪一条，这儿就是那一条的对话。**一条一个**，
// 各记各的，永久累积。
//
// 平时不在 —— 一条都没摊开时 Library 整块不渲染它，中栏自己铺满。
// 摊开才划出来。放在旁边而不是塞进条目里，是为了改描述时原文和商量
// 在同一屏上对着看。
//
// 说话那一整套（发、边想边出字、重说、终止）走 useChat —— 跟机会线那页
// 用的是同一份实现，不是照抄的第二份。这儿只剩渲染。
//
// 这一条上的 Fairwind **一个字都写不进库**：它写的每段话都是给你看的稿子，
// 进不进档案是你自己选中、复制、在上面那一格里改。所以这儿没有信卡、
// 没有表卡、没有状态卡 —— 它没有那些能力。

export default function EntryChat({ entry, onClose }) {
  const chat = useChat({
    owner: { kind: 'studio', id: entry.id },
    reload: () => fetchStudioThread(entry.id),
    rewind: rewindStudio,
  })
  const { msgs, setMsgs, text, setText, busy, err, setErr, editId, setEditId, live, act } = chat

  // 重开一轮：划一道线。线以上的留在屏幕上，只是它不再读了。
  const restart = async () => {
    if (busy) return
    setErr(null)
    try {
      const row = await restartStudio(entry.id)
      if (row) setMsgs((m) => [...m, row])
    } catch (e) { setErr(t('没划上：') + e.message) }
  }
  const endRef = useRef(null)
  const taRef = useRef(null)
  useGrow(taRef, text)

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
        {/* × 把这一条收起来 —— 抽屉和「这条摊着没摊着」是同一件事，
            两个开关各管一半的话，你会关掉抽屉却不知道怎么让它回来。 */}
        {onClose && <button className="echat-x" onClick={onClose} aria-label={t('收起这一条')}>×</button>}
        {t('一起写《{title}》', { title: entry.title || t('未命名') })}
        {/* 重开一轮 = 划一道线，不是清空。上面那些话还在，往上滚就看得见；
            变的只是它不再读线以上的。所以没有「确定要清空吗」这道问 —— 没什么会没。 */}
        {msgs.length > 0 && (
          <button className="echat-new" onClick={restart} disabled={busy}
                  title={t('从这儿重开一轮：上面的话还在，但它不再带着它们想')}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
                 strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
            </svg>
            {t('重开一轮')}
          </button>
        )}
        <i>{t('它带着你整个档案，但这次只说这一条。')}
          {t('写出来的字进不了档案——你自己复制到左边那一格里。')}</i>
      </div>

      <div className="echat-thread">
        {msgs.length === 0 && !busy && (
          <div className="empty-thread">
            {t('这段描述哪儿不准？想把它写成什么样？')}<br />
            {t('它说的每段话都是稿子，你挑要的那段复制到左边。')}
          </div>
        )}
        {msgs.map((m, i) => {
          if (m.kind === 'restart') {
            return <div className="echat-line" key={m.id || i}><span>{t('从这儿重开的')}</span></div>
          }
          const mine = m.role === 'artist'
          return (
            <div id={'msg-' + m.id} key={m.id || i} className={'msg' + (mine ? ' you' : ' producer')}>
              <span className="who">{mine ? t('你') : 'Fairwind'}</span>
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
      {/* 输入框跟机会卡那边是同一套：同样的胶囊、同样那颗圆按钮（.composer .ph / .send）。
          原来这儿是一颗写着「说」的方按钮 —— 同一个动作在两处长两个样，没有道理。 */}
      <div className="echat-composer">
        <div className="composer flat">
          {/* isComposing 那句不能删——中文输入法选词时也会敲 Enter，
              不挡的话你选个词就把半句话发出去了。 */}
          <textarea
            ref={taRef}
            className="ph"
            rows={1}
            value={text}
            disabled={busy}
            placeholder={busy ? t('在想……（想完会自动出现，你不用守着）')
              : t('这段描述哪儿不准？想把它写成什么样？')}
            onChange={(e) => { setText(e.target.value); if (err) setErr(null) }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
              e.preventDefault()
              chat.send()
            }}
          />
          {busy ? (
            <button className="send stop" aria-label={t('终止')} title={t('终止——停掉它这次的回复')} onClick={chat.stop}>
              <svg width="15" height="15" viewBox="0 0 16 16"><rect x="4.5" y="4.5" width="7" height="7" rx="1.4" fill="#fff" /></svg>
            </button>
          ) : (
            <button className="send" aria-label={t('发送')} onClick={() => chat.send()} disabled={!text.trim()}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M8 3 4.5 6.5M8 3l3.5 3.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
