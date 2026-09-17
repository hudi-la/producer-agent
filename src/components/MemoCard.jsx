import React, { useState } from 'react'
import { undoMemo } from '../lib/stateMoves.js'

// 它在聊天里记住了一句（0125）—— 出现的时候已经记完了，卡上只有【撤回】。
// 记忆不是事件：不动提醒栏。线上是一条「记忆」笔；人身上是关系记忆末尾多一段。
export default function MemoCard({ msgId, memo, onUndone }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [undone, setUndone] = useState(Boolean(memo.undone))

  async function undo() {
    setBusy(true); setErr(null)
    try {
      await undoMemo(msgId)
      setUndone(true)
      await onUndone?.()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`lcard scard${undone ? ' scard-undone' : ''}`}>
      <div className="lcard-h">
        <span className="lcard-tag">
          {undone ? '撤回了' : memo.to === 'person' ? '记进了关系记忆' : '记住了'}
        </span>
      </div>
      <div className="lcard-sub">{memo.line || memo.text}</div>
      {err && <div className="lcard-err">{err}</div>}
      {!undone && (
        <button className="lnk" disabled={busy} onClick={undo}>
          {busy ? '撤着……' : '撤回'}
        </button>
      )}
    </div>
  )
}
