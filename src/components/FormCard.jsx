import ErrorNotice from './ErrorNotice.jsx'
import React, { useState } from 'react'
import { adoptForm } from '../lib/forms.js'
import { t } from '../i18n/index.js'

// 对话里那条回复其实是一张填好的申请表 —— 就画成一张表的样子。
//
// 跟 LetterCard 是一对：卡只负责「收」，改和用都在右栏产出那份上。
//
// ── 卡上为什么要把字数上限也摆出来 ────────────────────────────
// 这张表的价值全在**逐格的字数闸**上（"max 300 words" 那种）。在卡上就
// 看得见的话，你一眼能发现它有没有把某一格的上限听错——听错的上限比没有
// 上限更坏，你会照着那个假的去改。
const limitOf = (f) =>
  Array.isArray(f.words) ? (f.words[0] ? t('{a}–{b} 词', { a: f.words[0], b: f.words[1] }) : t('≤ {n} 词', { n: f.words[1] }))
  : Array.isArray(f.chars) ? (f.chars[0] ? t('{a}–{b} 字符', { a: f.chars[0], b: f.chars[1] }) : t('≤ {n} 字符', { n: f.chars[1] }))
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
        <span className="lcard-tag">{t('这是一张填好的表')}</span>
        <span className="lcard-to">{t('{n} 格', { n: form.fields.length })}</span>
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
              {!f.a?.trim() && <span className="fempty">{t('没写')}</span>}
            </li>
          )
        })}
      </ul>
      {err && <ErrorNotice error={err} context={t('保存更改')} />}
      {done ? (
        <div className="lcard-ok">{t('收进产出了 —— 去右栏一格一格改。')}</div>
      ) : (
        <button className="lnk" disabled={busy} onClick={go}>
          {busy ? t('收着……') : t('收进产出（{n} 格，去那儿改）', { n: form.fields.length })}
        </button>
      )}
    </div>
  )
}
