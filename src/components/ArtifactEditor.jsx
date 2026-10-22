import { t } from '../i18n/index.js'
import ErrorNotice from './ErrorNotice.jsx'
import React, { useState } from 'react'
import { editDeliverable } from '../lib/deliverables.js'
import { setRecipients } from '../lib/letters.js'
import { setAnswer } from '../lib/forms.js'

export default function ArtifactEditor({ d, onChanged, onClose }) {
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
  return <aside className="fc-r artifact-editor">
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
