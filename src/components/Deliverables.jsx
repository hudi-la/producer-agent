import React, { useEffect, useRef, useState } from 'react'
import { checkRules, itemProgress, formProgress } from '../lib/rules.js'
import { editDeliverable, setFinal, newDeliverable, deleteDeliverable, putInDraftbox } from '../lib/deliverables.js'
import { sendLetterNow } from '../lib/letters.js'
import { setAnswer } from '../lib/forms.js'
// 这封信到底发给谁——名单从信头账本算，你自己勾。
import Recipients from './Recipients.jsx'
import { useModules } from '../lib/ModulesContext.jsx'

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

// 申请表：一格一个框，一格一条闸。
//
// ══ 为什么不是八份产出 ════════════════════════════════════════
// 一张申请表是**一件事**。拆成八份就要定稿八次、左栏文件里散成八份，
// 而且「这张表填完了没有」没有任何一处回答得了。
//
// ══ 为什么闸必须逐格 ══════════════════════════════════════════
// 网页表单是**逐格拒收**的。八格加起来没超，不等于每一格都没超——
// 合成一条闸的话，你到提交前一刻才发现第三格多了 40 个词。
//
// 规则在 rules.fields、答案在 meta.answers（见 0069）。

function Field({ d, f, check, onErr, onChanged }) {
  const saved = d.meta?.answers?.[f.key] ?? ''
  const [text, setText] = useState(saved)
  const [dirty, setDirty] = useState(false)
  const first = useRef(true)

  // 换一份产出、或者 Fairwind 重写了一版收进来，都要把框里的字换成库里那份。
  // 不换的话你看到的是上一份的答案，而它跟下面那条闸算的**不是同一段字**。
  useEffect(() => { setText(saved); setDirty(false); first.current = true }, [d.id, f.key, saved])

  // 自动存，跟正文编辑器同一套节奏。**一格一支 RPC**，不整包写回——
  // 整包的话你在这一格打字会连别的格子一起写一遍，可能拿旧快照盖掉
  // 另一次自动存刚写进去的新值。
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setDirty(true)
    const t = setTimeout(async () => {
      try {
        await setAnswer(d.id, f.key, text)
        setDirty(false)
        await onChanged?.()
      } catch (e) { onErr?.(e.message) }
    }, 700)
    return () => clearTimeout(t)
  }, [text])

  return (
    <div className="dvf">
      {/* 题目用**原文**摆着——你要照着往网页表单里填，翻译过的对不上号 */}
      <label className="dvf-q">{f.q}</label>
      <textarea
        className="dv-edit"
        value={text}
        rows={4}
        placeholder="还没填。你写，或者回中栏让 Fairwind 起一版。"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="dvf-foot">
        <span className={'dvf-n ' + (check?.ok ? 'ok' : 'bad')}>
          {check?.ok ? '✓' : '!'} {check?.label}
        </span>
        {check?.detail && <span className="dvf-lim">{check.detail}</span>}
        <span className="dv-save">{dirty ? '存中…' : ''}</span>
      </div>
    </div>
  )
}

function FormEditor({ d, onErr, onChanged, pursuitId }) {
  const fields = d.rules?.fields || []
  const { checks, allOk } = checkRules(d.rules, null, d.meta)
  const byKey = Object.fromEntries(checks.filter((c) => c.field).map((c) => [c.key, c]))
  return (
    <>
      {fields.map((f) => (
        <Field key={f.key} d={d} f={f} check={byKey['field:' + f.key]}
          onErr={onErr} onChanged={onChanged} />
      ))}
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
  const [busy, setBusy] = useState(null)
  // 两段确认的第二段：按第一下只是「上膛」，第二下才真发。
  const [armed, setArmed] = useState(false)
  const mods = useModules()
  const isMail = d.kind === 'email'
  // 收件人是一份名单（0071）。老产出里存的是单个字符串，两种都认——
  // 不认的话，改之前收进产出的那几封信一封都发不出去。
  const to = Array.isArray(d.meta?.to) ? d.meta.to : d.meta?.to ? [d.meta.to] : []
  const cc = Array.isArray(d.meta?.cc) ? d.meta.cc : []
  const n = to.length + cc.length
  // 按钮上写「2 人」而不是把三个地址挤成一行：地址长起来会把按钮撑爆，
  // 而**谁**在上面那份名单里逐个看得见，这儿只需要答「几个」。
  const whoSay = n === 1 ? to[0] : `${n} 人`

  // 文字类：定稿 = 搬到左栏。
  //
  // 邮件类：**定稿这个动作不存在**，它的终点是「发出去」。发出去之后这份产出
  // 就从右栏消失了——产出装的是「还没交出去的东西」，交出去了它就成了左栏往来
  // 里一条真信。这样右栏永远只剩欠着的，一眼知道还欠什么。
  //
  // （2026-08-16 之前这儿只有「放进 Gmail 草稿箱」，最后那下发送要你切去
  // 邮箱按。那条路留着当退路——要加附件的信还得走它。）
  async function go(what) {
    setBusy(what)
    try {
      if (what === 'send') await sendLetterNow({ pursuitId }, d.id)
      else if (what === 'draft') await putInDraftbox(pursuitId, d.id)
      else await setFinal(d.id, true)
      setArmed(false)
      await onChanged?.()
    } catch (e) {
      setArmed(false)
      // 授权掉了要说人话，别让你对着一句 HTTP 401 猜
      onErr?.(e.needsAuth && e.fix ? `${e.message}（${e.fix}）` : e.message)
    } finally { setBusy(null) }
  }

  if (!isMail) {
    return (
      <div className="dv-acts">
        <button className="b primary" disabled={!allOk || busy} onClick={() => go('final')}
          title={allOk ? '' : '规则没过，先把上面那几条弄对'}>
          {busy ? '定稿中……' : '定稿'}
        </button>
        {!allOk && <span className="dv-why">规则没过，定不了稿</span>}
      </div>
    )
  }

  const canSend = allOk && to.length > 0 && !busy
  return (
    <>
      {/* 名单摆在按钮上面，逐个可勾。**看不全就不敢发**——2026-08-18 那次
          Huntington 的信要回给两个人，界面上只有一个地址，于是那封信只能
          切回 Gmail 手动 reply all。 */}
      {mods.mail && <Recipients d={d} onChanged={onChanged} onErr={onErr} />}
    <div className="dv-acts">
      {/* 收件人明摆在按钮上，不许藏在折叠里——**发错人是这条路上唯一
          撤不回来的错**。别的都能补：改错字能再发一封，主题不好看下次注意；
          发给了不该发的人补不回来。 */}
      <button className="b primary" disabled={!canSend}
        onClick={() => (armed ? go('send') : setArmed(true))}
        onBlur={() => setArmed(false)}
        title={!allOk ? '规则没过，先把上面那几条弄对' : !to.length ? '这份产出上没有收件人' : ''}>
        {busy === 'send' ? '正在发……' : armed ? `确认发给 ${whoSay}` : '发送'}
      </button>
      {armed
        ? <span className="dv-why warn">按下去信就出去了，撤不回来。</span>
        : <span className="dv-why">{
            !allOk ? '规则没过，发不了'
              : !to.length ? '一个收件人都没勾，发不了'
              : `发给 ${whoSay}${cc.length ? `（含抄送 ${cc.length}）` : ''} · 发出后当场记进左栏往来`
          }</span>}
      {/* 退路：要加附件（作品集 PDF）的信走这条——放进草稿箱，去 Gmail 挂上附件再发。 */}
      {mods.mail && <button className="b" disabled={!allOk || busy} onClick={() => go('draft')}
        title="要加附件的信走这条：放进草稿箱，去 Gmail 挂上附件再发">
        {busy === 'draft' ? '正在放……' : d.meta?.gmail_draft_id ? '再放一次草稿箱' : '放进草稿箱'}
      </button>}
    </div>
    </>
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
        const fprog = formProgress(d.rules, d.meta)
        return (
          <div className="dv" key={d.id}>
            <div className="dv-top">
              <h4>{d.title}</h4>
              <span className={'pill ' + (d.blocked_by || waiting ? 'block'
                : d.kind === 'email' && d.meta?.gmail_draft_id ? 'ready' : 'draft')}>
                {waiting ? '等前一份定稿'
                  : d.blocked_by ? '挡住了'
                  // 一张表填到什么程度，一眼看得见——这是「一份产出装一张表」
                  // 换来的东西：拆成八份的话这句话没处说。
                  : fprog ? `${fprog.hit} / ${fprog.total} 格过闸`
                  : d.kind === 'email' && d.meta?.gmail_draft_id ? '在草稿箱 · 那份要你自己按'
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
              ) : Array.isArray(d.rules?.fields) ? (
                <FormEditor d={d} onErr={report} onChanged={onChanged} pursuitId={pursuitId} />
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
