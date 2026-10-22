// src/components/TaskToast.jsx —— 右下角「正在加进通讯录」的小窗(2026-10-08)。
// 跟收信那个小窗(BackfillToast)一个样子、叠在同一摞里。做完不自己消失:说加好了几个、哪几个没加上,按确认才收。
import { useBgTask, clearBgTask } from '../lib/bgTask.js'
import { t } from '../i18n/index.js'

const Ico = ({ children }) => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

export default function TaskToast() {
  const s = useBgTask()
  if (!s) return null
  const ok = s.done - s.failed.length
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0
  return (
    <div className="bf-toast" role="status" aria-live="polite">
      <div className="bf-h">
        {s.finished ? <span className="bf-ico ok"><Ico><path d="M20 6 9 17l-5-5" /></Ico></span> : <span className="spin" />}
        <b>{s.finished ? t('加好了') : t('正在加进通讯录…')}</b>
      </div>
      {!s.finished && <div className="bf-bar"><i style={{ width: `${Math.max(3, pct)}%` }} /></div>}
      <p>{s.finished
        ? (s.failed.length ? t('{n} 个加进通讯录了，{f} 个没加上。', { n: ok, f: s.failed.length }) : t('{n} 个都加进通讯录了，他们的往来信也归到了各自名下。', { n: ok }))
        : t('已加 {d} / {t} 个', { d: s.done, t: s.total }) + (s.current ? ` · ${s.current}` : '')}</p>
      {s.finished && s.failed.length > 0 && <small>{t('没加上的还留在「新联系人」里，可以再试一次：')}{s.failed.slice(0, 3).join(t('、'))}{s.failed.length > 3 ? '…' : ''}</small>}
      {!s.finished && <small>{t('可以切到别的页面，它会接着加；先别关掉这个网页。')}</small>}
      {s.finished && <button className="bf-ok" onClick={clearBgTask}>{t('确认')}</button>}
    </div>
  )
}
