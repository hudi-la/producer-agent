import React, { useState } from 'react'
import { TASK_DESC } from '../data/schema.js'

function stateLabel(t) {
  if (!t.enabled) return '未接 · 可加'
  if (t.schedule === 'weekly') return '开 · 每周'
  if (t.schedule) return '开 · ' + t.schedule
  return '常开'
}

// scout 那条可以当场跑一轮(brain 去真的开网页看源,几十秒)。
// 别的任务类型还没有「跑一次」的后端,不摆按钮——摆一个点了没反应的
// 按钮比不摆更坏。
const RUNNABLE = new Set(['scout_aggregators'])

export default function TasksPanel({ tasks, open, onClose, onRunScout }) {
  const [busy, setBusy] = useState(null)     // 正在跑的 task id
  const [note, setNote] = useState(null)     // { id, text }
  async function run(t) {
    if (busy) return
    setBusy(t.id); setNote(null)
    try {
      const r = await onRunScout(t)
      setNote({ id: t.id, text: r?.ok === false ? (r.note || '没跑成')
        : `落了 ${r?.added ?? 0} 张${r?.skipped ? `(跳过 ${r.skipped})` : ''}` })
    } catch (e) {
      setNote({ id: t.id, text: '没跑成:' + e.message })
    } finally { setBusy(null) }
  }
  return (
    <>
      <div className={'ov-scrim' + (open ? ' on' : '')} onClick={onClose} aria-hidden="true" />
      <div className={'taskmodal' + (open ? ' open' : '')} role="dialog" aria-label="造卡任务" aria-hidden={!open}>
        <div className="tm-head">
          <h3>造卡任务</h3>
          <button className="btn" onClick={onClose}>收起</button>
        </div>
        <p className="tm-intro">机会从这些任务流进「新机会」。<b>scout 只是第一条</b>，你可以一条条加——每条都是个小造卡器，往同一条流水线丢卡。</p>
        <div className="tm-list">
          {tasks.map((t) => (
            <div className={'task' + (t.enabled ? '' : ' off')} key={t.id || t.type}>
              <div className="task-main">
                <div className="task-t">{t.name}</div>
                <div className="task-d">{TASK_DESC[t.type] || t.type}</div>
                {t.last_result && t.enabled && <div className="task-r">上次 · {t.last_result}</div>}
                {note?.id === t.id && <div className="task-r">{note.text}</div>}
              </div>
              <div className="task-side">
                {t.enabled && RUNNABLE.has(t.type) && onRunScout && (
                  <button type="button" className="btn task-run" disabled={!!busy}
                          onClick={() => run(t)}>
                    {busy === t.id ? '在扫…' : '跑一次'}
                  </button>
                )}
                <span className={'task-state' + (t.enabled ? ' on' : '')}>{stateLabel(t)}</span>
                <span className={'toggle' + (t.enabled ? ' on' : '')} aria-hidden="true"><span className="knob" /></span>
              </div>
            </div>
          ))}
        </div>
        <div className="tm-add">+ 加一个造卡任务</div>
      </div>
    </>
  )
}
