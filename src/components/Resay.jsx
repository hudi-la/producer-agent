import React, { useEffect, useRef, useState } from 'react'
import Md from './Md.jsx'
import { canRewind, wipeCount } from '../lib/rewind.js'

// 你说过的那句气泡，外加「改这句」。
//
// 设计稿：docs/specs/2026-08-15-resay-design.md
//
// 机会线（PursuitFocus）和人（PersonFocus）共用这一份。两边的 .who 那行不一样
// （一个可能标「同时发给了 N 条线」，一个标日期），所以这儿只管气泡本身，
// 名字那行留给各自。抄两份的话，两边的确认文案和快捷键会各自漂移——
// Md.jsx 就是这么分叉过一次的。
//
// ── 为什么是就地改，不是「点一下直接删」 ───────────────────────
// 照 EditRow.jsx 那条规矩：**改之后要确认，存是你说了算**。点「改这句」库里
// 一个字没动，只是气泡变成输入框；撤掉是「重说」那一下的一部分。所以你改到
// 一半走开、按了取消、关掉页面，对话都原样在那儿。

/** 「重说之后会没掉什么」——说清楚，别让人自己猜。 */
function warnText(msgs, id) {
  const n = wipeCount(msgs, id)
  if (!n) return '重说之后，这句会换成你改的版本'
  return `重说之后，这句和它后面的 ${n} 条对话就没了（邮件和你记的都留着）`
}

/**
 * @param m         这条消息
 * @param msgs      整条流（用来数「后面还有几条」）
 * @param editing   是不是正在改这条
 * @param disabled  正在想 —— 这时候不给改，那会撤掉一条它还在写的回复
 * @param onStart   点了「改这句」
 * @param onCancel  取消
 * @param onResay   确认重说，带着改完的文字
 */
export default function SayBubble({ m, msgs, editing, disabled, onStart, onCancel, onResay }) {
  const [draft, setDraft] = useState(m.content || '')
  const ref = useRef(null)

  // 每次进编辑都从当前原文起步。不重置的话，你改了一半按取消、再点开，
  // 看到的是上次没提交的残稿——而屏幕上的气泡明明是另一句。
  useEffect(() => { if (editing) setDraft(m.content || '') }, [editing, m.content])

  // 光标落在末尾，并按内容把框撑到跟原来那段话一样高。
  // 落在开头的话，你想接着往下改得先按一次 End；框只有一行的话，
  // 一段长话进去只能从针眼里看。
  useEffect(() => {
    const el = ref.current
    if (!editing || !el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [editing])

  useEffect(() => {
    const el = ref.current
    if (!el || !editing) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [draft, editing])

  if (editing) {
    return (
      <div className="resay">
        <textarea
          ref={ref}
          className="resay-in"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); return }
            // Enter 重说 / Shift+Enter 换行 —— 跟下面输入框同一套手感。
            // isComposing 那句不能删：中文输入法选词也敲 Enter，
            // 不挡的话你选个词就把半句话提交了。
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            if (draft.trim()) onResay?.(m.id, draft)
          }}
        />
        <div className="ed-act">
          <button className="ed-ok" onClick={() => onResay?.(m.id, draft)} disabled={!draft.trim()}>
            重说
          </button>
          <button className="ed-no" onClick={onCancel}>取消</button>
        </div>
        <div className="resay-warn">{warnText(msgs, m.id)}</div>
      </div>
    )
  }

  return (
    <div className="saywrap">
      <div className="bubble md"><Md>{m.content}</Md></div>
      {canRewind(m) && !disabled && (
        <button className="resay-btn" onClick={() => onStart?.(m.id)}
                title="改这句重说——这句和它之后的对话会撤掉">
          <span aria-hidden="true">✎</span> 改这句
        </button>
      )}
    </div>
  )
}
