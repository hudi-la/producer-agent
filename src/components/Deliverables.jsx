import React, { useEffect, useRef, useState } from 'react'
import { checkRules, itemProgress } from '../lib/rules.js'
import { editDeliverable, setFinal, newDeliverable, deleteDeliverable, putInDraftbox } from '../lib/deliverables.js'

// 右栏：交付。
//
// 一条规矩贯穿到底：**右边全是没定的，左边全是定了的，中间只有一个动作——定稿。**
// 所以这儿没有「复制」「从档案重新取」「打开表单」那些按钮。它们是工具不是状态，
// 混在一起人就不知道按哪个才算数。次要动作降级成 meta 行里的一个链接。
//
// 规则层（字数/词数/页数/大小/必填）是**闸**不是提醒：没过，「定稿」就是灰的。

const KIND_LABEL = {
  idea: '构想', concept: '概念文本', statement: '陈述', bio: 'Bio',
  email: '邮件', form: '表单', file: '文件',
}

function whereItGoes(kind) {
  return kind === 'email' ? '发出后去 左栏 · 往来' : '定稿后去 左栏 · 文件'
}

function Editor({ d, onSaved, onErr, onChanged, pursuitId }) {
  const [body, setBody] = useState(d.body || '')
  const [dirty, setDirty] = useState(false)
  const first = useRef(true)

  // 换一份产出时重置，别把上一份的正文留在框里
  useEffect(() => { setBody(d.body || ''); setDirty(false); first.current = true }, [d.id])

  // 自动存：停手 700ms 就写库。不设「保存」按钮——你在写东西，不该还要记得按一下。
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setDirty(true)
    const t = setTimeout(async () => {
      try {
        await editDeliverable(d.id, { body })
        setDirty(false)
        onSaved?.(d.id, body)
      } catch (e) { onErr?.(e.message) }
    }, 700)
    return () => clearTimeout(t)
  }, [body])

  const { checks, allOk } = checkRules(d.rules, body, d.meta, { needsBody: true })

  return (
    <>
      <textarea
        className="dv-edit"
        value={body}
        rows={d.kind === 'bio' ? 5 : 8}
        placeholder="还没有内容。你写，或者在中间那栏让 Fairwind 起一版。"
        onChange={(e) => setBody(e.target.value)}
      />
      {checks.filter((c) => !c.item).map((c) => (
        <div className="dv-rule" key={c.key}>
          <span className={c.ok ? 'ok' : 'bad'}>{c.ok ? '✓' : '!'}</span>
          <span>{c.label}</span>
          {c.detail && <span className="sp2">{c.detail}</span>}
        </div>
      ))}
      <span className="dv-save">{dirty ? '存中…' : ''}</span>
      <Acts d={d} allOk={allOk} onErr={onErr} onChanged={onChanged} pursuitId={pursuitId} />
    </>
  )
}

function Checklist({ d, onErr, onChanged, pursuitId }) {
  const { checks, allOk } = checkRules(d.rules, d.body, d.meta)
  return (
    <>
      <ul className="dv-checks">
        {checks.filter((c) => c.item).map((c) => (
          <li key={c.key}>
            <span className={'tick' + (c.ok ? ' on' : '')} aria-hidden="true">{c.ok ? '✓' : ''}</span>
            <span>{c.label}</span>
          </li>
        ))}
        {checks.filter((c) => !c.item).map((c) => (
          <li key={c.key}>
            <span className={'tick' + (c.ok ? ' on' : ' warn')} aria-hidden="true">{c.ok ? '✓' : '!'}</span>
            <span>{c.label} <span className="m">{c.detail}</span></span>
          </li>
        ))}
      </ul>
      <Acts d={d} allOk={allOk} onErr={onErr} onChanged={onChanged} pursuitId={pursuitId} />
    </>
  )
}

function Acts({ d, allOk, onErr, onChanged, pursuitId }) {
  const [busy, setBusy] = useState(false)
  const isMail = d.kind === 'email'
  const inBox = !!d.meta?.gmail_draft_id

  // 文字类：定稿 = 搬到左栏。
  // 邮件类：**定稿不在这一步**。这颗按钮只把信放进 Gmail 草稿箱，状态照旧留在右栏——
  // 只有你在 Gmail 里真按了发送、下次收信把它当成一封真信收回来，
  // 它才归到左栏往来，球权也才跟着翻。不这么分的话，系统会替你撒一个
  // 你察觉不到的谎：那条线显示「等回复」，而信还躺在草稿箱里没人收到。
  async function go() {
    setBusy(true)
    try {
      if (isMail) await putInDraftbox(pursuitId, d.id)
      else await setFinal(d.id, true)
      await onChanged?.()
    } catch (e) { onErr?.(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="dv-acts">
      <button className="b primary" disabled={!allOk || busy} onClick={go}
        title={allOk ? '' : '规则没过，先把上面那几条弄对'}>
        {busy ? (isMail ? '正在放……' : '定稿中……')
          : isMail ? (inBox ? '重放一版进草稿箱' : '放进 Gmail 草稿箱') : '定稿'}
      </button>
      {!allOk && <span className="dv-why">规则没过，{isMail ? '放不进去' : '定不了稿'}</span>}
      {isMail && allOk && !busy && (
        <span className="dv-why">
          {inBox ? '在你草稿箱里了 —— 发送要你自己按' : '放进草稿箱不等于发出去，球权不会跟着翻'}
        </span>
      )}
    </div>
  )
}

export default function Deliverables({ pursuitId, items, files, onChanged, onJump }) {
  const [err, setErr] = useState(null)
  const drafts = items.filter((d) => d.status === 'draft')

  async function add() {
    try { await newDeliverable(pursuitId); onChanged?.() } catch (e) { setErr(e.message) }
  }
  async function drop(id) {
    try { await deleteDeliverable(id); onChanged?.() } catch (e) { setErr(e.message) }
  }
  function report(msg) { setErr(msg) }

  return (
    <div className="deliv">
      <p className="secttl">产出</p>
      {err && <div className="dv-err">{err}</div>}

      {drafts.length === 0 && (
        <p className="empty">
          还没有产出。要交出去的东西——申请材料、回信、表单答案——都在这儿长出来。
          你可以自己建一份，或者在中间那栏跟 Fairwind 说「起一版」。
        </p>
      )}

      {drafts.map((d) => {
        const dep = d.depends_on ? items.find((x) => x.id === d.depends_on) : null
        const waiting = dep && dep.status !== 'final'
        const prog = itemProgress(d.rules, d.meta)
        return (
          <div className="dv" key={d.id}>
            <div className="dv-top">
              <h4>{d.title}</h4>
              <span className={'pill ' + (d.blocked_by || waiting ? 'block'
                : d.kind === 'email' && d.meta?.gmail_draft_id ? 'ready' : 'draft')}>
                {waiting ? '等前一份定稿'
                  : d.blocked_by ? '挡住了'
                  : d.kind === 'email' && d.meta?.gmail_draft_id ? '在草稿箱 · 等你按发送'
                  : prog ? `${prog.hit} / ${prog.total}` : '你在改'}
              </span>
            </div>
            <div className="dv-meta">
              {/* 类型跟标题一样时就不重复说一遍（「概念文本 · 概念文本」） */}
              {(KIND_LABEL[d.kind] || d.kind) !== d.title && <span>{KIND_LABEL[d.kind] || d.kind}</span>}
              {d.due && <span>到期 <b>{d.due}</b></span>}
              {d.source && <span>料来自 <b>{d.source}</b></span>}
              <span>{whereItGoes(d.kind)}</span>
            </div>
            <div className="dv-body">
              {waiting ? (
                <div className="dv-block">
                  等 <b>{dep.title}</b> 定稿。它没定，这份写了也要推翻重来。
                </div>
              ) : d.blocked_by ? (
                <div className="dv-block">
                  {d.blocked_by}
                  {d.blocked_ref && (
                    <button className="jump" onClick={() => onJump?.(d.blocked_ref)}>← 跳回那段对话</button>
                  )}
                </div>
              ) : Array.isArray(d.rules?.items) ? (
                <Checklist d={d} onErr={report} onChanged={onChanged} pursuitId={pursuitId} />
              ) : (
                <Editor d={d} onErr={report} onChanged={onChanged} pursuitId={pursuitId} />
              )}
              <button className="dv-del" onClick={() => drop(d.id)} title="删掉这份草稿">删掉</button>
            </div>
          </div>
        )
      })}

      <button className="newout" onClick={add}>+ 新建一份产出</button>

      {files.length > 0 && (
        <p className="dv-foot">另有 {files.length} 份已定稿，在左栏「文件」里。</p>
      )}
    </div>
  )
}
