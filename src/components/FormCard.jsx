import React, { useState } from 'react'
import { adoptForm } from '../lib/forms.js'

// 对话里那条回复其实是一张填好的申请表 —— 就画成一张表的样子。
//
// 跟 LetterCard 是一对：卡只负责「收」，改和用都在右栏产出那份上。
//
// ── 卡上为什么要把字数上限也摆出来 ────────────────────────────
// 这张表的价值全在**逐格的字数闸**上（"max 300 words" 那种）。在卡上就
// 看得见的话，你一眼能发现它有没有把某一格的上限听错——听错的上限比没有
// 上限更坏，你会照着那个假的去改。
const limitOf = (f) =>
  Array.isArray(f.words) ? (f.words[0] ? `${f.words[0]}–${f.words[1]} 词` : `≤ ${f.words[1]} 词`)
  : Array.isArray(f.chars) ? (f.chars[0] ? `${f.chars[0]}–${f.chars[1]} 字符` : `≤ ${f.chars[1]} 字符`)
  : null

export default function FormCard({ form, owner, onAdopted }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(false)

  async function go() {
    setBusy(true); setErr(null)
    try {
      await adoptForm(owner, form)
      setDone(true)
      await onAdopted?.()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lcard">
      <div className="lcard-h">
        <span className="lcard-tag">这是一张填好的表</span>
        <span className="lcard-to">{form.fields.length} 格</span>
      </div>
      <div className="lcard-sub">{form.title}</div>
      <ul className="fcard-qs">
        {form.fields.map((f) => {
          const lim = limitOf(f)
          return (
            <li key={f.key}>
              <span className="fq">{f.q}</span>
              {lim && <span className="flim">{lim}</span>}
              {/* 它只认出题目、没写答案的那几格标出来——不标的话你会以为
                  收进去就是填好的，到提交前才发现有空格。 */}
              {!f.a?.trim() && <span className="fempty">没写</span>}
            </li>
          )
        })}
      </ul>
      {err && <div className="lcard-err">{err}</div>}
      {done ? (
        <div className="lcard-ok">收进产出了 —— 去右栏一格一格改。</div>
      ) : (
        <button className="lnk" disabled={busy} onClick={go}>
          {busy ? '收着……' : `收进产出（${form.fields.length} 格，去那儿改）`}
        </button>
      )}
    </div>
  )
}
