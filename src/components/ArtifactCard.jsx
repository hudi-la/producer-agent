import { useModules } from '../lib/ModulesContext.jsx'
import { t } from '../i18n/index.js'
import ErrorNotice from './ErrorNotice.jsx'
import React, { useRef, useState } from 'react'
import { artifactRequest, setArtifactDiscarded } from '../lib/artifacts.js'
import { sendLetterNow } from '../lib/letters.js'
import { setFinal } from '../lib/deliverables.js'
import { checkRules } from '../lib/rules.js'
import Md from './Md.jsx'
import Recipients from './Recipients.jsx'

export default function ArtifactCard({ letter, form, messageId, owner, items = [], onAdopted, existing, editorOpen = false }) {
  const mods = useModules()
  const [saved, setSaved] = useState(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [err, setErr] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState('')
  const [discardedOverride, setDiscardedOverride] = useState(null)
  const d = existing || items.find(x => x.meta?.artifact_message_id === messageId) || saved
  const email = d ? d.kind === 'email' : !!letter
  const title = d?.title || letter?.subject || form?.title
  const body = d?.body ?? letter?.body
  const to = d?.meta?.to || letter?.to
  const fields = d?.rules?.fields || form?.fields || []
  const { allOk } = checkRules(d?.rules || {}, body, d?.meta || {}, { needsBody: email })
  const final = d?.status === 'final' || status === 'sent'
  const discarded = !final && (discardedOverride ?? d?.meta?.artifact_discarded)
  async function go(action) {
    if (lock.current || editorOpen || final) return
    lock.current = true; setBusy(true); setErr('')
    try {
      const current = d || await artifactRequest('/artifact', owner, { message_id: messageId })
      setSaved(current)
      if (action === 'discard' || action === 'restore') {
        const updated = await setArtifactDiscarded(current.id, action === 'discard')
        setSaved(updated); setDiscardedOverride(action === 'discard'); setConfirming(false)
        await onAdopted?.()
      } else if (action === 'edit') await onAdopted?.(current.id)
      else if (action === 'prepare') { setConfirming(true); await onAdopted?.() }
      else if (action === 'send') {
        await sendLetterNow(owner, current.id)
        setStatus('sent'); setConfirming(false); await onAdopted?.()
      } else if (action === 'final') {
        await setFinal(current.id, true); setSaved({ ...current, status: 'final' }); await onAdopted?.()
      } else {
        await artifactRequest('/gmail-draft', owner, { deliverable_id: current.id })
        setStatus('draft'); await onAdopted?.()
      }
    } catch (e) { setErr(e) }
    finally { lock.current = false; setBusy(false) }
  }
  if (discarded) return <div className="lcard artifact-card">
    <div className="lcard-h"><span className="lcard-tag">{t('邮件')}</span><span>{t('已放弃草稿')}</span></div>
    <div className="lcard-sub">{title}</div>
    {d?.meta?.gmail_draft_id && <p className="pf-note">{t('Gmail 草稿箱中的副本仍保留，可前往 Gmail 删除。')}</p>}
    {err && <ErrorNotice error={err} context={t('恢复草稿')} />}
    <button className="b" disabled={busy || editorOpen} onClick={() => go('restore')}>{t('恢复草稿')}</button>
  </div>
  return <div className="lcard artifact-card">
    <div className="lcard-h"><span className="lcard-tag">{email ? t('邮件') : fields.length ? t('申请表') : t('文档')}</span>
      <span>{final ? t('已完成') : status === 'draft' ? t('已存入 Gmail 草稿箱') : status === 'copied' ? t('已复制') : d?.meta?.gmail_draft_id ? t('在 Gmail 草稿箱') : t('草稿')}</span></div>
    <div className="lcard-sub">{title}</div>
    {email && <div className="lcard-to">{t('收件人：')}{Array.isArray(to) ? to.join(', ') : to}</div>}
    {body && <div className="lcard-body md"><Md>{body}</Md></div>}
    {!!fields.length && <div className="lcard-body">{fields.map(f => <section key={f.key}>
      <strong>{f.q}</strong><div className="md"><Md>{d?.meta?.answers?.[f.key] ?? f.a ?? ''}</Md></div>
    </section>)}</div>}
    {!email && <button className="lnk" onClick={async () => {
      try { await navigator.clipboard.writeText(fields.length ? fields.map(f => `${f.q}\n${d?.meta?.answers?.[f.key] ?? f.a ?? ''}`).join('\n\n') : body || ''); setStatus('copied') }
      catch { setErr(t('复制失败，请选中文本复制')) }
    }}>{t('复制内容')}</button>}
    {editorOpen && <p className="pf-note">{t('先保存或取消右栏的修改，再操作产出。')}</p>}
    {err && <ErrorNotice error={err} context={t('保存更改')} />}
    {!final && <div className="artifact-actions">
      <button className="b" disabled={busy || editorOpen} onClick={() => go('edit')}>{t('修改')}</button>
      {email && mods.mail && <><button className="b primary" disabled={busy || editorOpen} onClick={() => go('prepare')}>{t('发送')}</button>
        <button className="b" disabled={busy || editorOpen} onClick={() => go('draft')}>{t('存草稿箱')}</button></>}
      {email && <button className="b" disabled={busy || editorOpen} onClick={() => go('discard')}>{t('放弃草稿')}</button>}
      {!email && d && <button className="b" disabled={busy || editorOpen || !allOk} onClick={() => go('final')}>{t('定稿')}</button>}
      {busy && <span role="status">{t('处理中…')}</span>}
    </div>}
    {confirming && !final && d && <div className="artifact-confirm">
      <Recipients d={d} onChanged={() => onAdopted?.()} onErr={setErr} />
      <p>{t('确认发送以上正文给 {to}{cc}？', { to: Array.isArray(to) ? to.join(', ') : to, cc: d.meta?.cc?.length ? t('；抄送 {cc}', { cc: d.meta.cc.join(', ') }) : '' })}</p>
      <button className="b primary" disabled={busy || editorOpen || !allOk} onClick={() => go('send')}>{t('确认发送')}</button>
      <button className="b" disabled={busy || editorOpen} onClick={() => setConfirming(false)}>{t('取消')}</button>
    </div>}
  </div>
}
