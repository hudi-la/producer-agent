import { t } from '../i18n/index.js'
import ErrorNotice from './ErrorNotice.jsx'
import React, { useEffect, useRef, useState } from 'react'
import { attachmentUrl, editDeliverable } from '../lib/deliverables.js'
import { setRecipients } from '../lib/letters.js'
import { setAnswer } from '../lib/forms.js'

import { loadAttachment, isolatedHtml } from '../lib/attachmentPreview.js'

// Both modes use the existing document drawer and its responsive layout.
export default function ArtifactEditor(props) {
  return props.attachment ? <AttachmentDocument {...props} /> : <EditableDocument {...props} />
}

const readAttachment = (attachment, options) => loadAttachment(attachment, { ...options, sign: attachmentUrl })

function AttachmentDocument({ attachment, onClose, attachmentLoader = readAttachment }) {
  const closeRef = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    closeRef.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [attachment.id])
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    let release = () => {}
    setState({ loading: true })
    attachmentLoader(attachment, { signal: controller.signal }).then(result => {
      release = result.release
      if (disposed) release()
      else setState(result)
    }).catch(error => {
      if (!disposed) setState({ error })
    })
    return () => { disposed = true; controller.abort(); release() }
  }, [attachment.id, attachment.storage_key, attempt, attachmentLoader])
  return <aside className="fc-r artifact-editor attachment-document" aria-label={attachment.filename} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <h3>{attachment.filename}</h3>
    <div className="artifact-actions">
      <button ref={closeRef} className="b" onClick={onClose}>{t('关闭')}</button>
      {state.url && <a className="b" href={state.url} download={attachment.filename}>{t('下载')}</a>}
      <button className="b" onClick={() => setAttempt(n => n + 1)}>{t('重新加载')}</button>
    </div>
    {state.loading && <p role="status">{t('正在加载附件…')}</p>}
    {state.error && <><ErrorNotice error={state.error} context={t('附件')} />
      <button className="b" onClick={() => setAttempt(n => n + 1)}>{t('重试')}</button>
      {state.error.downloadUrl && <a className="b" href={state.error.downloadUrl} target="_blank" rel="noopener noreferrer">{t('直接打开原文件')}</a>}</>}
    {state.kind === 'text' && <pre className="attachment-text">{state.text}</pre>}
    {state.kind === 'html' && <iframe title={attachment.filename} sandbox="" referrerPolicy="no-referrer" srcDoc={isolatedHtml(state.text)} />}
    {state.kind === 'image' && <img src={state.url} alt={attachment.filename} />}
    {state.kind === 'pdf' && <iframe title={attachment.filename} src={state.url} />}
    {state.kind === 'download' && <p>{t('此文件暂不支持预览，请下载后打开。')}</p>}
  </aside>
}

function EditableDocument({ d, onChanged, onClose, hidden }) {
  const [title, setTitle] = useState(d.title || '')
  const [body, setBody] = useState(d.body || '')
  const [answers, setAnswers] = useState(d.meta?.answers || {})
  const list = v => Array.isArray(v) ? v.join(', ') : v || ''
  const [to, setTo] = useState(list(d.meta?.to))
  const [cc, setCc] = useState(list(d.meta?.cc))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fields = d.rules?.fields || []
  async function save() {
    setBusy(true); setErr('')
    try {
      if (d.kind === 'email') await setRecipients(d.id, to.split(/[,;，；]/).map(s => s.trim()).filter(Boolean), cc.split(/[,;，；]/).map(s => s.trim()).filter(Boolean))
      await editDeliverable(d.id, { title, body })
      for (const f of fields) if (answers[f.key] !== d.meta?.answers?.[f.key]) await setAnswer(d.id, f.key, answers[f.key] || '')
      await onChanged?.(); onClose()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return <aside className="fc-r artifact-editor" style={hidden ? { display: 'none' } : undefined}>
    <h3>{d.kind === 'email' ? t('修改邮件') : t('修改文档')}</h3>
    {d.kind === 'email' && <><label>{t('收件人')}<input value={to} onChange={e => setTo(e.target.value)} placeholder={t('多个邮箱用逗号分隔')} /></label>
      <label>{t('抄送')}<input value={cc} onChange={e => setCc(e.target.value)} /></label></>}
    <label>{t('标题')}<input value={title} onChange={e => setTitle(e.target.value)} /></label>
    {fields.length ? fields.map(f => <label key={f.key}>{f.q}
      {f.words && <small>{t('{n} 词', { n: f.words.join('–') })}</small>}{f.chars && <small>{t('{n} 字符', { n: f.chars.join('–') })}</small>}
      <textarea rows={6} value={answers[f.key] || ''} onChange={e => setAnswers({ ...answers, [f.key]: e.target.value })} />
    </label>) : <label>{t('正文')}<textarea rows={20} value={body} onChange={e => setBody(e.target.value)} /></label>}
    {err && <ErrorNotice error={err} context={t('保存更改')} />}
    <div className="artifact-actions"><button className="b primary" disabled={busy} onClick={save}>{busy ? t('保存中…') : t('保存并关闭')}</button>
      <button className="b" disabled={busy} onClick={onClose}>{t('取消修改')}</button></div>
  </aside>
}
