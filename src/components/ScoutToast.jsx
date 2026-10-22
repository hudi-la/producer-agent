import { useState } from 'react'
import { t } from '../i18n/index.js'
import { scoutToastState } from '../lib/scoutToast.js'

const seenKey = 'fw.scoutDoneSeen'

export default function ScoutToast({ tasks = [] }) {
  const [closed, setClosed] = useState(null)
  const s = scoutToastState(tasks)
  if (!s) return null
  const final = s.kind === 'complete' || (s.kind === 'failed' && !s.remaining)
  const sig = `${s.id}:${s.kind}:${final ? s.lastRunAt : (s.kind === 'paused' || s.kind === 'failed') ? s.updatedAt : ''}`
  if (closed === sig) return null
  if (final) {
    try { if (localStorage.getItem(`${seenKey}.${s.id}`) === sig) return null } catch {}
  }
  const close = () => {
    setClosed(sig)
    if (final) try { localStorage.setItem(`${seenKey}.${s.id}`, sig) } catch {}
  }
  const running = s.kind === 'running' || s.kind === 'resuming'
  const title = s.kind === 'queued' ? t('机会搜索已排队')
    : s.kind === 'resuming' ? t('正在续跑机会搜索…')
      : s.kind === 'running' ? t('正在搜索机会…')
        : s.kind === 'paused' ? t('机会搜索已暂停')
          : s.kind === 'stalled' ? t('机会搜索可能卡住了')
          : s.kind === 'failed' ? t('机会搜索遇到问题') : t('机会搜索完成')
  const progress = s.kind === 'complete'
    ? t('本轮已完成，详情见任务战报。')
    : s.done || s.remaining
    ? t('已处理 {done} 项，剩余 {left} 项；新增 {added} 个机会。', { done: s.done, left: s.remaining, added: s.added })
    : t('正在准备搜索。')
  return <div className="bf-toast" role="status" aria-live="polite">
    <div className="bf-h">
      {running || s.kind === 'queued' ? <span className="spin" /> : <span className="bf-ico wait" aria-hidden="true">{s.kind === 'complete' ? '✓' : 'Ⅱ'}</span>}
      <b>{title}</b>
      <button className="bf-x" onClick={close} aria-label={t('关掉')}>×</button>
    </div>
    <p>{progress}</p>
    {running && <small>{t('本批通常需要几分钟；可以切换页面，搜索会在后台继续。')}</small>}
    {s.kind === 'queued' && <small>{t('通常 30 秒内开始。')}</small>}
    {(s.kind === 'paused' || s.kind === 'failed' || s.kind === 'stalled') && <small>{s.note || t('进度已保存。')}{s.nextAt && s.kind !== 'stalled' ? ` ${t('下次自动尝试：{when}', { when: new Date(s.nextAt).toLocaleString() })}` : ''}</small>}
    {final && <button className="bf-ok" onClick={close}>{t('确认')}</button>}
  </div>
}
