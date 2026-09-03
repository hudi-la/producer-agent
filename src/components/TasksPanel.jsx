import React, { useEffect, useState } from 'react'
import { TASK_DESC } from '../data/schema.js'
import { WEEKDAYS, HOURS, scheduleText, runState, setTask, runTaskNow } from '../lib/tasks.js'
import { onPulse } from '../lib/pulse.js'

// 造卡任务面板。
//
// 2026-09-02 之前这儿是只读的：开关拨不动，「每周」只是个字，上次跑出什么靠人手填。
// 现在带提示词的任务（两条 scout）是真的了：开关、排期、提示词都在这儿改，
// 「现在跑一次」按下去脑子一分钟内接手。改法沿用档案页那套——**双击进编辑、
// 确定才存**，误触碰不到，存是你说了算。
//
// 脑子没开 = 到点不会跑。这件事必须说出来，不能让「每周一 08:00」看着像会自己发生。
//
// 设计稿：docs/specs/2026-09-02-scheduled-scout-design.md 第六节

function stateLabel(t) {
  if (!t.enabled) return t.prompt ? '关着' : '未接 · 可加'
  const s = scheduleText(t)
  return s ? '开 · ' + s : '常开'
}

/** 提示词那一格：双击改，⌘/Ctrl+Enter 确定，Esc 放弃。存不上就留在编辑态，错话摆在下面。 */
function PromptBox({ value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { if (!editing) setText(value || '') }, [value, editing])

  const start = () => { setErr(null); setText(value || ''); setEditing(true) }
  const cancel = () => { setText(value || ''); setErr(null); setEditing(false) }
  const commit = async () => {
    const next = text.trim()
    if (!next) { setErr('提示词不能是空的'); return }
    if (next === (value || '').trim()) { setEditing(false); return }
    setSaving(true); setErr(null)
    try { await onSave(next); setEditing(false) } catch (e) { setErr(e.message) }
    setSaving(false)
  }

  if (editing) {
    return (
      <div className="tk-prompt-edit">
        <textarea
          className="idin tk-ta" value={text} rows={14} autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit() }
          }}
        />
        <div className="ed-act">
          <button className="ed-ok" onMouseDown={(e) => e.preventDefault()} onClick={commit} disabled={saving}>{saving ? '存……' : '确定'}</button>
          <button className="ed-no" onMouseDown={(e) => e.preventDefault()} onClick={cancel} disabled={saving}>取消</button>
          {err && <span className="ed-err">没存上：{err}</span>}
        </div>
      </div>
    )
  }
  return (
    <pre className="tk-prompt" onDoubleClick={start} title="双击改">{value || '（还没写提示词）'}</pre>
  )
}

/** 一条带提示词的任务展开后的那块：排期、状态、提示词、现在跑一次、上次战报。 */
function Scheduled({ t, tz, brainUp, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [now, setNow] = useState(Date.now())
  // 「3 分钟前开始」那句要走字。面板开着才跳，跟卡片那些 setInterval 一样便宜。
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(iv) }, [])

  const save = async (patch) => {
    setBusy(true); setErr(null)
    try { await setTask(t.id, patch); await onChanged?.() } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const runNow = async () => {
    setBusy(true); setErr(null)
    try { await runTaskNow(t.id); await onChanged?.() } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const st = runState(t, { now, tz })
  const every = t.run_every || 'manual'
  const stop = (e) => e.stopPropagation()

  return (
    <div className="tk-body" onClick={stop} onDoubleClick={stop}>
      <div className="tk-row">
        <span className="tk-k">排期</span>
        <select className="tk-sel" value={every} disabled={busy}
          onChange={(e) => save({ run_every: e.target.value })}>
          <option value="manual">手动</option>
          <option value="week">每周</option>
          <option value="day">每天</option>
        </select>
        {every === 'week' && (
          <select className="tk-sel" value={t.run_weekday ?? 1} disabled={busy}
            onChange={(e) => save({ run_weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
          </select>
        )}
        {every !== 'manual' && (
          <select className="tk-sel" value={t.run_hour ?? 8} disabled={busy}
            onChange={(e) => save({ run_hour: Number(e.target.value) })}>
            {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        )}
        <span className="sp" />
        <button className="wbtn tk-run" disabled={busy || st.kind === 'running' || st.kind === 'queued'} onClick={runNow}>
          现在跑一次
        </button>
      </div>
      {/* 状态一句。脑子没开时「下次 9/7」是假话——那时候说的是「到点不会跑」。 */}
      <div className={'tk-state' + (st.kind === 'running' ? ' running' : '') + (!brainUp ? ' off' : '')}>
        {!brainUp
          ? '脑子没开 · 到点不会跑；开了会立刻补跑' + (st.kind === 'queued' ? '（已经排上了一次）' : '')
          : st.text || (every === 'manual' ? '不排期，想跑就按上面那颗' : '')}
      </div>
      {err && <div className="ed-err">没存上：{err}</div>}

      <div className="tk-k tk-k2">提示词</div>
      <PromptBox value={t.prompt} onSave={(prompt) => save({ prompt })} />
      <div className="tk-hint">今天几号、库里已有哪些机会、按什么格式报——系统跑的时候补在后面，这儿不用写。</div>

      {t.last_result && (
        <>
          <div className="tk-k tk-k2">上次</div>
          <pre className="tk-result">{t.last_result}</pre>
        </>
      )}
    </div>
  )
}

export default function TasksPanel({ tasks, open, onClose, brain = null, tz, onChanged }) {
  const [openId, setOpenId] = useState(null)
  const [flipping, setFlipping] = useState(null)   // 正在拨开关的那条
  const [flipErr, setFlipErr] = useState(null)

  // 面板开着就跟着 tasks 那一列脉搏走：脑子认领了、跑完了，这儿自己变。
  useEffect(() => {
    if (!open || !onChanged) return
    return onPulse('tasks', () => onChanged())
  }, [open, onChanged])

  const flip = async (t) => {
    setFlipping(t.id); setFlipErr(null)
    try { await setTask(t.id, { enabled: !t.enabled }); await onChanged?.() } catch (e) { setFlipErr(e.message) }
    setFlipping(null)
  }

  const brainUp = Boolean(brain?.up)

  return (
    <>
      <div className={'ov-scrim' + (open ? ' on' : '')} onClick={onClose} aria-hidden="true" />
      <div className={'taskmodal' + (open ? ' open' : '')} role="dialog" aria-label="造卡任务" aria-hidden={!open}>
        <div className="tm-head">
          <h3>造卡任务</h3>
          <button className="btn" onClick={onClose}>收起</button>
        </div>
        <p className="tm-intro">机会从这些任务流进「新机会」。<b>带提示词的那几条是定时跑的</b>——点开能改排期和提示词；其余是手动跑的专项。</p>
        {brain && !brainUp && (
          <div className="tk-warn">脑子没开——到点的任务不会跑。另开一个终端跑 <code>npm run brain</code>，开了会立刻补跑。</div>
        )}
        {flipErr && <div className="ed-err">没存上：{flipErr}</div>}
        <div className="tm-list">
          {tasks.map((t) => {
            const real = Boolean(t.prompt)
            const expanded = real && openId === t.id
            return (
              <div className={'task' + (t.enabled ? '' : ' off') + (real ? ' real' : '') + (expanded ? ' open' : '')} key={t.id || t.type}>
                <div
                  className="task-head"
                  role={real ? 'button' : undefined}
                  tabIndex={real ? 0 : undefined}
                  onClick={real ? () => setOpenId(expanded ? null : t.id) : undefined}
                  onKeyDown={real ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(expanded ? null : t.id) } } : undefined}
                >
                  <div className="task-main">
                    <div className="task-t">{t.name}</div>
                    <div className="task-d">{TASK_DESC[t.type] || t.type}</div>
                    {/* 折着的时候只给一句：排期 + 现在什么状态 */}
                    {real && !expanded && (
                      <div className="task-r">
                        {scheduleText(t)}
                        {(() => { const s = runState(t, { tz }); return s.text ? ` · ${s.text}` : '' })()}
                        {t.last_result ? ` · 上次：${t.last_result.split('\n')[0].slice(0, 60)}` : ''}
                      </div>
                    )}
                    {!real && t.last_result && t.enabled && <div className="task-r">上次 · {t.last_result}</div>}
                  </div>
                  <div className="task-side">
                    <span className={'task-state' + (t.enabled ? ' on' : '')}>{stateLabel(t)}</span>
                    {real ? (
                      <button
                        type="button"
                        className={'toggle' + (t.enabled ? ' on' : '')}
                        role="switch"
                        aria-checked={t.enabled}
                        aria-label={t.enabled ? '关掉这条任务' : '打开这条任务'}
                        disabled={flipping === t.id}
                        onClick={(e) => { e.stopPropagation(); flip(t) }}
                      ><span className="knob" /></button>
                    ) : (
                      <span className={'toggle' + (t.enabled ? ' on' : '')} aria-hidden="true"><span className="knob" /></span>
                    )}
                  </div>
                </div>
                {expanded && <Scheduled t={t} tz={tz} brainUp={brainUp} onChanged={onChanged} />}
              </div>
            )
          })}
        </div>
        <div className="tm-add">+ 加一个造卡任务</div>
      </div>
    </>
  )
}
