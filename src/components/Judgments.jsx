import ErrorNotice from './ErrorNotice.jsx'
import { errorText } from '../lib/userError.js'
// src/components/Judgments.jsx —— 「我的判据」:开关 + 判据目录在哪 + 「看看会怎么变」。
// 本机:判据文档住在数据目录里,住在邮件开关底下;托管(2026-10-02 起):住在库里那个人的几行,
// 住在账号块里,目录那句不出(没有目录)。骨架在代码里,这儿只管口味那一层。
import { useEffect, useState } from 'react'
import { t } from '../i18n/index.js'
import { brainApi } from '../lib/backends.js'

const fmt = (v) => (v == null || v === '' ? '—' : String(v).replace('T', ' ').slice(0, 16))

export default function Judgments() {
  const [error, setError] = useState(null)
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState(null)
  const [files, setFiles] = useState(null)      // { 文件名: 内容 }
  const [editing, setEditing] = useState(null)  // 正在改哪个文件
  const [draft, setDraft] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const loadFiles = () => brainApi.judgments.files().then((r) => r.error ? setError(r.error) : setFiles(r.files || {}))
  useEffect(() => { loadFiles() }, [])
  const openFile = (f) => { setEditing(f); setDraft(files?.[f] || ''); setSaveMsg('') }
  const saveFile = async () => { const r = await brainApi.judgments.write(editing, draft); setSaveMsg(r.ok ? (r.lints?.length ? t('存好了；但这几句不生效：') + r.lints.join('；') : t('存好了，下一次判断就用新的')) : t('没存上:') + errorText(r.error)); await loadFiles() }
  const load = () => brainApi.settings.get().then((r) => { if (r.error) setError(r.error); else setS(r) })
  useEffect(() => { load() }, [])
  if (!s) return <ErrorNotice error={error} onRetry={load} />
  const flip = async () => { const r = await brainApi.settings.set({ judgmentsEnabled: !s.judgmentsEnabled }); if (r.error) { setError(r.error); return }; setError(null); await load() }
  const preview = async () => {
    setBusy(true); setOut(null)
    const r = await brainApi.judgments.preview(20)
    setBusy(false); setOut(r)
  }
  return (
    <section className="judgments">
      <ErrorNotice error={error} />
      <div className="kind-h la-h">{t('我的判据')}<small>{t('Fairwind 每次判断都读这些;骨架在程序里,口味在你这儿')}</small></div>
      <div className="jd-row">
        <label className="jd-switch">
          <input type="checkbox" checked={s.judgmentsEnabled !== false} onChange={flip} />
          {s.judgmentsEnabled !== false ? t('用我的判据') : t('用出厂判据(我的先关着)')}
        </label>
        {s.judgmentsDir !== '' && <span className="jd-dir">{t('文件在 ')}<code className="jd-path" title={s.judgmentsDir || ''}>{s.judgmentsDir || 'judgments/'}</code>{t(',怎么写看里面的 README')}</span>}
        <span className="sp" />
        <button type="button" className="b" disabled={busy} onClick={preview}>{busy ? t('在判…') : t('看看会怎么变')}</button>
      </div>
      {files && (
        <div className="jd-files">
          {Object.keys(files).map((f) => (
            <button key={f} type="button" className={'jd-file' + (editing === f ? ' on' : '') + (files[f]?.trim() ? ' has' : '')} onClick={() => openFile(f)}>
              {f.replace(/\.md$/, '')}{files[f]?.trim() ? '' : <small> · {t('空')}</small>}
            </button>
          ))}
        </div>
      )}
      {editing && (
        <div className="jd-editor">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} placeholder={t('像跟熟这行的助手交代一样写几句。比如：投递类我等 30 天再问；拿不准宁可提醒我。')} />
          <div className="la-acts">
            <button type="button" className="b primary" onClick={saveFile}>{t('保存')}</button>
            <button type="button" className="b" onClick={() => setEditing(null)}>{t('收起')}</button>
            {saveMsg && (saveMsg.startsWith(t('没存上:')) ? <ErrorNotice error={saveMsg} /> : <span className="la-note">{saveMsg}</span>)}
          </div>
        </div>
      )}
      {out && (out.error
        ? <ErrorNotice error={out.error} />
        : out.n === 0
          ? <div className="jd-empty">{t('还没有判过的事——收几封信、记几笔之后再来看。')}</div>
          : (
            <>
              <div className="jd-sum">{t('最近 {n} 件,{c} 件结论变了', { n: out.n, c: out.changed })}{out.usingJudgments ? '' : t('(判据文档现在是空的或关着的)')}</div>
              <table className="jd-table">
                <thead><tr><th>{t('谁 · 什么时候')}</th><th>{t('原来')}</th><th>{t('现在')}</th></tr></thead>
                <tbody>
                  {out.rows.map((r) => (
                    <tr key={r.id} className={r.changed ? 'changed' : ''}>
                      <td><b>{r.subject}</b><br /><small>{r.who} · {fmt(r.when)} · {r.situation}</small></td>
                      <td><Tag t={r.old} /></td>
                      <td>{r.new ? <Tag t={r.new} /> : <ErrorNotice error={r.note || t('没判出来')} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ))}
    </section>
  )
}

function Tag({ t: tag }) {
  if (!tag) return <small>—</small>
  return (
    <div className="jd-tag">
      <div>{tag.needs_reply === true ? t('要回') : tag.needs_reply === false ? t('不用回') : '—'}{t(' · 等 {d} 天 · 见面 {m}', { d: fmt(tag.wait_days), m: fmt(tag.meet_at) })}</div>
      <small>{tag.gist || ''}</small>
    </div>
  )
}
