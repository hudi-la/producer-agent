import ErrorNotice from './ErrorNotice.jsx'
import React, { useState } from 'react'
import { undoStateMove, adoptStateMove, GATE_TEXT } from '../lib/stateMoves.js'
import { t } from '../i18n/index.js'

// 提醒改动的小卡。两种样子（2026-10-24）：
//
//   已落地（applied）—— 聊天里你说了一件事，Fairwind 改了提醒。出现时已经改完，卡上只有【撤回】。
//                        这是他定的：聊天为准，默认落地，按了能撤回。
//   建议（proposed）—— 后台到点时你不在场提的，或理由说「已发出」却查不到真信。没落地，
//                        卡上写清为什么只是建议，按【采纳】才改。
export default function StateMoveCard({ msgId, move, owner, onUndone }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [undone, setUndone] = useState(Boolean(move.undone))
  const [adopted, setAdopted] = useState(Boolean(move.applied))
  const proposal = !adopted

  async function undo() {
    setBusy(true); setErr(null)
    try {
      await undoStateMove(msgId)
      setUndone(true)
      await onUndone?.()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function adopt() {
    setBusy(true); setErr(null)
    try {
      await adoptStateMove(owner, msgId)
      setAdopted(true); setUndone(false)
      await onUndone?.()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const tag = proposal ? t('建议改提醒') : undone ? t('撤回了 —— 提醒长回去了') : t('提醒改成了')
  return (
    <div className={`lcard scard${undone ? ' scard-undone' : ''}${proposal ? ' scard-proposal' : ''}`}>
      <div className="lcard-h"><span className="lcard-tag">{tag}</span></div>
      <div className="lcard-sub">{move.line}</div>
      {move.why && <div className="scard-why">{t('凭什么：{why}', { why: move.why })}</div>}
      {proposal && move.gate && GATE_TEXT[move.gate] && <div className="scard-why">{t(GATE_TEXT[move.gate])}</div>}
      {err && <ErrorNotice error={err} context={t('保存更改')} />}
      {proposal && owner && (
        <button className="lnk" disabled={busy} onClick={adopt}>{busy ? t('改着……') : t('采纳')}</button>
      )}
      {!proposal && !undone && (
        <button className="lnk" disabled={busy} onClick={undo}>{busy ? t('撤着……') : t('撤回')}</button>
      )}
    </div>
  )
}
