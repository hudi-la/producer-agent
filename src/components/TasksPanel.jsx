import React, { useEffect, useRef, useState } from 'react'
import { useGrow } from '../lib/useGrow.js'
import { TASK_DESC } from '../data/schema.js'
import { WEEKDAYS, HOURS, scheduleText, runState, setTask, runTaskNow, groupTasks } from '../lib/tasks.js'
import { onPulse } from '../lib/pulse.js'

// 造卡任务面板。
//
// ══ 只有第一组是真的（2026-09-03）═══════════════════════════════
//
// 他问：手动那几条「后台应该不连任何地方，对不对？」——对。树皮书、媒体艺术、
// 模特经纪那三条是他当时手动跑出来的，后台没有任何东西会再跑它们。
// 给它们一个拨不动的开关、写一个「开 · 手动」，是在说一件不成立的事。
//
// 所以分四组，**判据在 lib/tasks.js 的 groupTasks 里**：
//   定时跑的   有提示词 → 开关、排期、提示词、现在跑一次
//   跑过的专项 没提示词但跑过 → 只有战报，没有开关
//   卡的出处   你自己丢的 → 一行字
//   还没接     列个名字
//
// 战报一个字都不删：那几份里有「查了但没建卡的和原因」，是负面结果，也是信息。
//
// 提示词改法沿用档案页那套：**双击进编辑、确定才存**。误触碰不到，存是他说了算。
//
// 设计稿：docs/specs/2026-09-03-opportunity-pool-design.md 第七节

/** 提示词那一格：双击改，⌘/Ctrl+Enter 确定，Esc 放弃。存不上就留在编辑态，错话摆在下面。 */
function PromptBox({ value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { if (!editing) setText(value || '') }, [value, editing])
  const ta = useRef(null)
  useGrow(ta, text, editing)

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
          ref={ta} className="idin tk-ta" value={text} rows={6} autoFocus
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
  return <pre className="tk-prompt" onDoubleClick={start} title="双击改">{value || '（还没写提示词）'}</pre>
}

/** 一条定时任务展开后的那块：排期、状态、提示词、现在跑一次、上次战报。 */
function Scheduled({ t, tz, brainUp, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [now, setNow] = useState(Date.now())
  // 「3 分钟前开始」那句要走字。面板开着才跳。
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
      {/* 脑子没开时「下次 9/7」是假话——那时候要说的是「到点不会跑」。 */}
      <div className={'tk-state' + (st.kind === 'running' ? ' running' : '') + (!brainUp ? ' off' : '')}>
        {!brainUp
          ? '脑子没开 · 到点不会跑；开了会立刻补跑' + (st.kind === 'queued' ? '（已经排上了一次）' : '')
          : st.text || (every === 'manual' ? '不排期，想跑就按上面那颗' : '')}
      </div>
      {err && <div className="ed-err">没存上：{err}</div>}

      <div className="tk-k tk-k2">提示词</div>
      <PromptBox value={t.prompt} onSave={(prompt) => save({ prompt })} />
      <div className="tk-hint">
        今天几号、表里已有哪些机会、按什么格式报——系统跑的时候补在后面，这儿不用写。
        「复查表里哪几行、判几个够不够得着、最多造几张卡」在这条任务的 config 里。
      </div>

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
  const [flipping, setFlipping] = useState(null)
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
  const { timed, ran, origins, notYet } = groupTasks(tasks)
  const ago = (iso) => (iso ? String(iso).slice(0, 10) : null)

  return (
    <>
      <div className={'ov-scrim' + (open ? ' on' : '')} onClick={onClose} aria-hidden="true" />
      <div className={'taskmodal' + (open ? ' open' : '')} role="dialog" aria-label="造卡任务" aria-hidden={!open}>
        <div className="tm-head">
          <h3>造卡任务</h3>
          <button className="btn" onClick={onClose}>收起</button>
        </div>

        {brain && !brainUp && (
          <div className="tk-warn">脑子没开——到点的任务不会跑。另开一个终端跑 <code>npm run brain</code>，开了会立刻补跑。</div>
        )}
        {flipErr && <div className="ed-err">没存上：{flipErr}</div>}

        {/* ── 一、真的会自己跑的 ── */}
        <div className="tm-sec">定时跑的</div>
        <p className="tm-intro">脑子到点自己跑：先查关注表里那些开了没有，再出去找新的，最后把够得着的造成卡。点开能改排期和提示词。</p>
        <div className="tm-list">
          {timed.map((t) => {
            const expanded = openId === t.id
            return (
              <div className={'task real' + (t.enabled ? '' : ' off') + (expanded ? ' open' : '')} key={t.id || t.type}>
                <div
                  className="task-head" role="button" tabIndex={0}
                  onClick={() => setOpenId(expanded ? null : t.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(expanded ? null : t.id) } }}
                >
                  <div className="task-main">
                    <div className="task-t">{t.name}</div>
                    <div className="task-d">{TASK_DESC[t.type] || t.type}</div>
                    {!expanded && (
                      <div className="task-r">
                        {scheduleText(t)}
                        {(() => { const s = runState(t, { tz }); return s.text ? ` · ${s.text}` : '' })()}
                        {t.last_result ? ` · 上次：${t.last_result.split('\n').slice(1).join(' ').slice(0, 60) || t.last_result.slice(0, 60)}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="task-side">
                    <span className={'task-state' + (t.enabled ? ' on' : '')}>
                      {t.enabled ? '开 · ' + scheduleText(t) : '关着'}
                    </span>
                    <button
                      type="button"
                      className={'toggle' + (t.enabled ? ' on' : '')}
                      role="switch" aria-checked={t.enabled}
                      aria-label={t.enabled ? '关掉这条任务' : '打开这条任务'}
                      disabled={flipping === t.id}
                      onClick={(e) => { e.stopPropagation(); flip(t) }}
                    ><span className="knob" /></button>
                  </div>
                </div>
                {expanded && <Scheduled t={t} tz={tz} brainUp={brainUp} onChanged={onChanged} />}
              </div>
            )
          })}
        </div>

        {/* ── 二、跑过的专项：历史，没有开关 ── */}
        {ran.length > 0 && (
          <>
            <div className="tm-sec">跑过的专项</div>
            <p className="tm-intro sub">当时手动跑出来的一批，后台不会再跑它们。战报留着——里面有查了但没建卡的和原因。</p>
            <div className="tm-list">
              {ran.map((t) => (
                <div className="task past" key={t.id || t.name}>
                  <div className="task-head">
                    <div className="task-main">
                      <div className="task-t">{t.name}</div>
                      {/* 这儿**不写 TASK_DESC** —— 那句话（「它开下一轮 open call 就造张卡」）
                          描述的是这类任务本来会干的事，而这几条现在什么都不干。
                          战报说的才是真发生过的事。 */}
                      {t.last_result && <pre className="tk-result past">{t.last_result}</pre>}
                    </div>
                    <span className="task-when">{ago(t.last_run_at) || '跑过'}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── 三、四：一行字带过。给它们开关就是假着。 ── */}
        {origins.length > 0 && (
          <div className="tm-line">
            <b>卡的出处</b>：{origins.map((t) => t.name).join(' · ')}——不是任务，是你手动贴进来的卡挂的标记。
          </div>
        )}
        {notYet.length > 0 && (
          <div className="tm-line">
            <b>还没接</b>：{notYet.map((t) => t.name).join(' · ')}
          </div>
        )}
      </div>
    </>
  )
}
