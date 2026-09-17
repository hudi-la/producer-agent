import React, { useRef, useState } from 'react'
import { useGrow } from '../lib/useGrow.js'

// 对选中的 N 条线说同一句话。
//
// 为什么是一个输入框而不是几个预设按钮：**预测不了你想批量干什么**。
// 「起草邮件」只是今天想得到的一种，明天你可能想让 15 条线各自去查一下
// 对方最近有没有新动向。指令是开放的，按钮是封闭的。
export default function SayTo({ n, onSend, onCancel }) {
  const [text, setText] = useState('')
  const t = text.trim()
  const ta = useRef(null)
  useGrow(ta, text)

  return (
    <>
      <div className="ov-scrim on" onClick={onCancel} aria-hidden="true" />
      <div className="sayto" role="dialog" aria-label={`对选中的 ${n} 条线说一句`}>
        <h3 className="sayto-t">对选中的 {n} 条线说一句</h3>
        {/* 说清楚它会怎么落地——这句话会写进每条线的对话，是不可撤销的记录 */}
        <p className="sayto-s">同一句话分别说给每条线，各答各的（它们的料不一样）。这句会记进每条线的对话，标明是群发。</p>
        <textarea
          ref={ta}
          className="sayto-in"
          value={text}
          autoFocus
          rows={4}
          placeholder="帮我起一封信问问工作坊的具体日程和场地……"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
            // Enter 换行，⌘/Ctrl+Enter 发出去 —— 这是多行输入，回车不该是提交
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && t) { e.preventDefault(); onSend(t) }
          }}
        />
        <div className="sayto-btns">
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="wbtn" disabled={!t} onClick={() => onSend(t)}>发给 {n} 条</button>
        </div>
      </div>
    </>
  )
}
