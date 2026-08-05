import React from 'react'
import { TASK_DESC } from '../data/tasksSeed.js'

function stateLabel(t) {
  if (!t.enabled) return '未接 · 可加'
  if (t.schedule === 'weekly') return '开 · 每周'
  if (t.schedule) return '开 · ' + t.schedule
  return '常开'
}

export default function TasksPanel({ tasks, open, onClose }) {
  return (
    <>
      <div className={'ov-scrim' + (open ? ' on' : '')} onClick={onClose} aria-hidden="true" />
      <div className={'taskmodal' + (open ? ' open' : '')} role="dialog" aria-label="造卡任务" aria-hidden={!open}>
        <div className="tm-head">
          <h3>造卡任务</h3>
          <button className="btn" onClick={onClose}>收起</button>
        </div>
        <p className="tm-intro">机会从这些任务流进「待批准」。<b>scout 只是第一条</b>，你可以一条条加——每条都是个小造卡器，往同一条流水线丢卡。</p>
        <div className="tm-list">
          {tasks.map((t) => (
            <div className={'task' + (t.enabled ? '' : ' off')} key={t.id || t.type}>
              <div className="task-main">
                <div className="task-t">{t.name}</div>
                <div className="task-d">{TASK_DESC[t.type] || t.type}</div>
                {t.last_result && t.enabled && <div className="task-r">上次 · {t.last_result}</div>}
              </div>
              <div className="task-side">
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
