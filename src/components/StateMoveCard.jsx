import React, { useState } from 'react'
import { undoStateMove } from '../lib/stateMoves.js'
import { t } from '../i18n/index.js'

// 它在聊天里改了提醒 —— 气泡底下摆一张小卡，**出现的时候已经改完了**。
//
// 跟 LetterCard 的分工反过来：信是「它写，你收」；提醒是「它改，你否」
// （2026-09-04 他定的：不是按来确认，是默认确认、按就撤回）。
// 提醒栏和卡面金字读的是 v_pa_state，标签一落就变；这张卡只负责让你看见
// 改了什么、凭什么，以及那一个撤回的按钮。撤回不限时。
export default function StateMoveCard({ msgId, move, onUndone }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [undone, setUndone] = useState(Boolean(move.undone))

  async function undo() {
    setBusy(true); setErr(null)
    try {
      await undoStateMove(msgId)
      setUndone(true)
      // 提醒栏和往来靠 pulse 自己重拉（标签一删库就动了）；onUndone 是给要立刻重读的那栏用的
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
        <span className="lcard-tag">{undone ? t('撤回了 —— 提醒长回去了') : t('提醒改成了')}</span>
      </div>
      <div className="lcard-sub">{move.line}</div>
      {move.why && <div className="scard-why">{t('凭什么：{why}', { why: move.why })}</div>}
      {err && <div className="lcard-err">{err}</div>}
      {!undone && (
        <button className="lnk" disabled={busy} onClick={undo}>
          {busy ? t('撤着……') : t('撤回')}
        </button>
      )}
    </div>
  )
}
