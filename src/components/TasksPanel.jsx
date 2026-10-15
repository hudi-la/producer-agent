import ErrorNotice from './ErrorNotice.jsx'
import React, { useEffect, useRef, useState } from 'react'
import { useGrow } from '../lib/useGrow.js'
import { TASK_DESC } from '../data/schema.js'
import { WEEKDAYS, HOURS, scheduleText, runState, setTask, runTaskNow, groupTasks } from '../lib/tasks.js'
import { onPulse } from '../lib/pulse.js'
import { t } from '../i18n/index.js'

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
//
// 这个文件里任务对象一律叫 task / tk，不叫 t —— t 是 i18n 的那个函数。

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
    if (!next) { setErr(t('提示词不能是空的')); return }
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
          <button className="ed-ok" onMouseDown={(e) => e.preventDefault()} onClick={commit} disabled={saving}>{saving ? t('存……') : t('确定')}</button>
          <button className="ed-no" onMouseDown={(e) => e.preventDefault()} onClick={cancel} disabled={saving}>{t('取消')}</button>
          {err && <ErrorNotice error={err} context={t('保存更改')} />}
        </div>
      </div>
    )
  }
  return <pre className="tk-prompt" onDoubleClick={start} title={t('双击改')}>{value || t('（还没写提示词）')}</pre>
}

/** 一条定时任务展开后的那块：排期、状态、提示词、现在跑一次、上次战报。 */
function Scheduled({ task, tz, brainUp, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [now, setNow] = useState(Date.now())
  // 「3 分钟前开始」那句要走字。面板开着才跳。
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(iv) }, [])

  const save = async (patch) => {
    setBusy(true); setErr(null)
    try { await setTask(task.id, patch); await onChanged?.() } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const runNow = async () => {
    setBusy(true); setErr(null)
    try { await runTaskNow(task.id); await onChanged?.() } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const st = runState(task, { now, tz })
  const every = task.run_every || 'manual'
  const stop = (e) => e.stopPropagation()

  return (
    <div className="tk-body" onClick={stop} onDoubleClick={stop}>
      <div className="tk-row">
        <span className="tk-k">{t('排期')}</span>
        <select className="tk-sel" value={every} disabled={busy}
          onChange={(e) => save({ run_every: e.target.value })}>
          <option value="manual">{t('手动')}</option>
          <option value="week">{t('每周')}</option>
          <option value="day">{t('每天')}</option>
        </select>
        {every === 'week' && (
          <select className="tk-sel" value={task.run_weekday ?? 1} disabled={busy}
            onChange={(e) => save({ run_weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
          </select>
        )}
        {every !== 'manual' && (
          <select className="tk-sel" value={task.run_hour ?? 8} disabled={busy}
            onChange={(e) => save({ run_hour: Number(e.target.value) })}>
            {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        )}
        <span className="sp" />
        <button className="wbtn tk-run" disabled={busy || st.kind === 'running' || st.kind === 'queued'} onClick={runNow}>
          {t('现在跑一次')}
        </button>
      </div>
      {/* 脑子没开时「下次 9/7」是假话——那时候要说的是「到点不会跑」。 */}
      {['queued', 'running', 'paused', 'failed'].includes(st.kind) ? (
        <div className={'tk-progress ' + st.kind + (!brainUp ? ' off' : '')} role="status" aria-live="polite">
          <span className="tk-progress-icon" aria-hidden="true" />
          <div>
            <strong>{st.kind === 'failed' ? t('搜索遇到问题，进度已保留')
              : st.kind === 'paused' ? t('搜索已暂停，等待续跑')
              : st.kind === 'queued'
              ? (brainUp ? t('已排队，等待开始') : t('已排队，等待 Fairwind 启动'))
              : t('正在找机会')}</strong>
            <div className="tk-progress-detail">{st.kind === 'paused' || st.kind === 'failed' ? st.text
              : st.kind === 'queued'
              ? (brainUp ? t('通常 30 秒内开始；整轮预计 5–20 分钟，取决于网页和模型响应。') : t('Fairwind 启动后会接着运行；整轮预计 5–20 分钟。'))
              : t('通常需要 5–20 分钟，机会多时可能更久。{elapsed}', { elapsed: st.text })}</div>
          </div>
        </div>
      ) : (
        <div className={'tk-state' + (!brainUp ? ' off' : '')}>
          {!brainUp ? t('脑子没开 · 到点不会跑；开了会立刻补跑') : st.text || (every === 'manual' ? t('不排期，想跑就按上面那颗') : '')}
        </div>
      )}
      {err && <ErrorNotice error={err} context={t('保存更改')} />}

      <div className="tk-k tk-k2">{t('提示词')}</div>
      <PromptBox value={task.prompt} onSave={(prompt) => save({ prompt })} />
      <div className="tk-hint">
        {t('今天几号、表里已有哪些机会、按什么格式报——系统跑的时候补在后面，这儿不用写。「复查表里哪几行、判几个够不够得着、最多造几张卡」在这条任务的 config 里。')}
        {task.type?.startsWith('scout') && <div>{t('每批最多 {n} 次模型调用；每个来源先挑最多 {c} 个候选逐个核实。未完成的进度会保存，通常约 {m} 分钟后续跑。修改提示词会重新生成尚未完成的搜索队列。', {
          n: task.config?.model_calls_per_run || task.config?.search_calls_per_run || 6,
          c: task.config?.candidates_per_source || 4,
          m: task.config?.search_resume_minutes || 180,
        })}</div>}
      </div>

      {task.last_result && (
        <>
          <div className="tk-k tk-k2">{t('上次')}</div>
          <Report text={task.last_result} />
        </>
      )}
    </div>
  )
}

/** 战报:第一行是日期,后面一步一条。以前是整段 <pre> 贴出来,报错 JSON 也原样露着,像草稿(9/29 他指出来) */
function Report({ text, past = false }) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const [head, ...steps] = lines
  return (
    <div className={'tk-result' + (past ? ' past' : '')}>
      {head && <div className="tk-result-d">{head}</div>}
      <ul>{steps.map((l, i) => <li key={i} className={l.startsWith('⚠️') ? 'warn' : undefined}>{l}</li>)}</ul>
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

  const flip = async (tk) => {
    setFlipping(tk.id); setFlipErr(null)
    try { await setTask(tk.id, { enabled: !tk.enabled }); await onChanged?.() } catch (e) { setFlipErr(e.message) }
    setFlipping(null)
  }

  const brainUp = Boolean(brain?.up)
  const { timed, ran, origins, notYet } = groupTasks(tasks)
  const ago = (iso) => (iso ? String(iso).slice(0, 10) : null)

  return (
    <>
      <div className={'ov-scrim' + (open ? ' on' : '')} onClick={onClose} aria-hidden="true" />
      <div className={'taskmodal' + (open ? ' open' : '')} role="dialog" aria-label={t('造卡任务')} aria-hidden={!open}>
        <div className="tm-head">
          <h3>{t('造卡任务')}</h3>
          <button className="btn" onClick={onClose}>{t('收起')}</button>
        </div>

        {brain && !brainUp && (
          <div className="tk-warn">{t('脑子没开——到点的任务不会跑。另开一个终端跑 ')}<code>npm run brain</code>{t('，开了会立刻补跑。')}</div>
        )}
        {flipErr && <ErrorNotice error={flipErr} />}

        {/* ── 一、真的会自己跑的 ── */}
        <div className="tm-sec">{t('定时跑的')}</div>
        <p className="tm-intro">{t('脑子到点自己跑：先查关注表里那些开了没有，再出去找新的，最后把够得着的造成卡。点开能改排期和提示词。')}</p>
        <div className="tm-list">
          {timed.map((tk) => {
            const expanded = openId === tk.id
            return (
              <div className={'task real' + (tk.enabled ? '' : ' off') + (expanded ? ' open' : '')} key={tk.id || tk.type}>
                <div
                  className="task-head" role="button" tabIndex={0}
                  onClick={() => setOpenId(expanded ? null : tk.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(expanded ? null : tk.id) } }}
                >
                  <div className="task-main">
                    <div className="task-t">{t(tk.name)}</div>
                    <div className="task-d">{TASK_DESC[tk.type] || tk.type}</div>
                    {!expanded && (
                      <div className="task-r">
                        {scheduleText(tk)}
                        {(() => { const s = runState(tk, { tz }); return s.text ? ` · ${s.text}` : '' })()}
                        {tk.last_result ? t(' · 上次：{s}', { s: tk.last_result.split('\n').slice(1).join(' ').slice(0, 60) || tk.last_result.slice(0, 60) }) : ''}
                      </div>
                    )}
                  </div>
                  <div className="task-side">
                    <span className={'task-state' + (tk.enabled ? ' on' : '')}>
                      {tk.enabled ? t('开 · {s}', { s: scheduleText(tk) }) : t('关着')}
                    </span>
                    <button
                      type="button"
                      className={'toggle' + (tk.enabled ? ' on' : '')}
                      role="switch" aria-checked={tk.enabled}
                      aria-label={tk.enabled ? t('关掉这条任务') : t('打开这条任务')}
                      disabled={flipping === tk.id}
                      onClick={(e) => { e.stopPropagation(); flip(tk) }}
                    ><span className="knob" /></button>
                  </div>
                </div>
                {expanded && <Scheduled task={tk} tz={tz} brainUp={brainUp} onChanged={onChanged} />}
              </div>
            )
          })}
        </div>

        {/* ── 二、跑过的专项：历史，没有开关 ── */}
        {ran.length > 0 && (
          <>
            <div className="tm-sec">{t('跑过的专项')}</div>
            <p className="tm-intro sub">{t('当时手动跑出来的一批，后台不会再跑它们。战报留着——里面有查了但没建卡的和原因。')}</p>
            <div className="tm-list">
              {ran.map((tk) => (
                <div className="task past" key={tk.id || tk.name}>
                  <div className="task-head">
                    <div className="task-main">
                      <div className="task-t">{t(tk.name)}</div>
                      {/* 这儿**不写 TASK_DESC** —— 那句话（「它开下一轮 open call 就造张卡」）
                          描述的是这类任务本来会干的事，而这几条现在什么都不干。
                          战报说的才是真发生过的事。 */}
                      {tk.last_result && <Report text={tk.last_result} past />}
                    </div>
                    <span className="task-when">{ago(tk.last_run_at) || t('跑过')}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── 三、四：一行字带过。给它们开关就是假着。 ── */}
        {origins.length > 0 && (
          <div className="tm-line">
            <b>{t('卡的出处')}</b>{t('：')}{origins.map((tk) => t(tk.name)).join(' · ')}{t('——不是任务，是你手动贴进来的卡挂的标记。')}
          </div>
        )}
        {notYet.length > 0 && (
          <div className="tm-line">
            <b>{t('还没接')}</b>{t('：')}{notYet.map((tk) => t(tk.name)).join(' · ')}
          </div>
        )}
      </div>
    </>
  )
}
