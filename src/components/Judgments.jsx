import ErrorNotice from './ErrorNotice.jsx'
import { errorText } from '../lib/userError.js'
// src/components/Judgments.jsx —— 「我的判据」:开关 + 判据目录在哪 + 「看看会怎么变」。
// 本机:判据文档住在数据目录里,住在邮件开关底下;托管(2026-10-02 起):住在库里那个人的几行,
// 住在账号块里,目录那句不出(没有目录)。骨架在代码里,这儿只管口味那一层。
import { useEffect, useState } from 'react'
import { t } from '../i18n/index.js'
import { brainApi } from '../lib/backends.js'
import { defaultJudgment, isDefaultJudgment } from '../lib/judgmentDefaults.js'

const fmt = (v) => (v == null || v === '' ? '—' : String(v).replace('T', ' ').slice(0, 16))

// 文件名是给程序认的,人看的是「什么时候用」
const WHEN = {
  '全部.md': t('每次都用'),
  '对方来信.md': t('对方来信时'),
  '我发出的信.md': t('我发出信后'),
  '手记.md': t('我记笔记时'),
  '见面之后.md': t('见面之后'),
}

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
  // 没写过的那格:输入框里直接是默认的几句,想改哪句改哪句(10/8 他说「默认的能不能直接写在上面」)
  const openFile = (f) => { setEditing(f); setDraft(files?.[f]?.trim() ? files[f] : defaultJudgment(f)); setSaveMsg('') }
  // 写了就是要用:原来还有个「用不用我的判据」开关,10/7 他说看不懂——拿掉了;以前关过的,一保存就打开
  const saveFile = async () => {
    // 一字没改 = 还是用默认:存空,系统默认以后更新了也跟着走
    const r = await brainApi.judgments.write(editing, isDefaultJudgment(editing, draft) ? '' : draft)
    if (r.ok && s?.judgmentsEnabled === false) { await brainApi.settings.set({ judgmentsEnabled: true }); await load() }
    setSaveMsg(r.ok ? (r.lints?.length ? t('存好了；但这几句不生效：') + r.lints.join(t('；')) : t('存好了，下一封信就照这个判')) : t('没存上:') + errorText(r.error)); await loadFiles()
  }
  const load = () => brainApi.settings.get().then((r) => { if (r.error) setError(r.error); else setS(r) })
  useEffect(() => { load() }, [])
  if (!s) return <ErrorNotice error={error} onRetry={load} />
  const preview = async () => {
    setBusy(true); setOut(null)
    const r = await brainApi.judgments.preview(20)
    setBusy(false); setOut(r)
  }
  return (
    <section className="judgments">
      <ErrorNotice error={error} />
      {/* 2026-10-07 他说「出厂判据」「看看会怎么变」连他都看不懂——全换成人话:这块管什么、什么时候用、怎么写 */}
      <div className="kind-h la-h">{t('我的判据')}</div>
      <p className="jd-lead">{t('每来一封信、你每发一封信，Fairwind 都会替你判断：要不要回、对方在等你什么、过几天该提醒你。下面每一格点开，就能看到它默认是怎么判的；想改哪句就改哪句，它就照你的来。')}</p>
      {s.judgmentsDir !== '' && <span className="jd-dir">{t('文件在 ')}<code className="jd-path" title={s.judgmentsDir || ''}>{s.judgmentsDir || 'judgments/'}</code>{t(',怎么写看里面的 README')}</span>}
      {files && (
        <div className="jd-files">
          {Object.keys(files).map((f) => (
            <button key={f} type="button" className={'jd-file' + (editing === f ? ' on' : '') + (files[f]?.trim() ? ' has' : '')} onClick={() => openFile(f)}>
              {WHEN[f] || f.replace(/\.md$/, '')}{files[f]?.trim() ? <small> · {t('我改过')}</small> : <small> · {t('用默认')}</small>}
            </button>
          ))}
        </div>
      )}
      {/* 试一下:写过东西才有意义;说清楚它干什么 */}
      {files && Object.values(files).some((x) => x?.trim()) && (
        <div className="jd-row">
          <button type="button" className="b" disabled={busy} onClick={preview}>{busy ? t('在判…') : t('试一下')}</button>
          <small className="jd-dir">{t('拿最近 20 件事，照你写的再判一遍，看哪些判得跟原来不一样。只是看看，不会改任何东西。')}</small>
        </div>
      )}
      {editing && (
        <div className="jd-editor">
          <small className="jd-dir">{files?.[editing]?.trim() ? t('这一格按你写的判。删空了保存，就回到默认。') : t('这是默认的判法。想改哪句就改哪句，保存后按你的来。')}</small>
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
              <div className="jd-sum">{t('最近 {n} 件里，有 {c} 件照你写的会判得不一样', { n: out.n, c: out.changed })}</div>
              <table className="jd-table">
                <thead><tr><th>{t('谁 · 什么时候')}</th><th>{t('原来判的')}</th><th>{t('照你写的判')}</th></tr></thead>
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
