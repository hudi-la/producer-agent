import React, { useState } from 'react'
import { adoptLetter } from '../lib/letters.js'
import Md from './Md.jsx'

// 对话里那条回复其实是一封信 —— 就画成一封信的样子。
//
// 在这之前，它写的信只能靠你选中、复制、切去 Gmail 粘贴。这张卡是那条路的
// 出口：一眼看见收件人、主题和**信的全文**，点一下就落进产出。
//
// ── 信为什么长在卡里，不长在上面那个气泡里（2026-08-18 改）──
// 原来信封只带 to/subject，卡拿不到信本身，于是收进产出的是**整条消息**
// ——「好的，我帮你回一封……」那些话跟信混在一起，成了待发的正文。
// 现在信住在信封的 body 里：上面的气泡留给它对你说的话，信在这张卡上。
//
// ── 卡上为什么不是「发送」 ────────────────────────────────────
// 收进产出和发送之间隔着一步，那一步是给你改字用的（你自己说的，
// 稿子搬进邮箱之后经常改字）。合成一步的话，「点错一下就发出去了」
// 这种错在这个系统里第一次变得可能——而信发出去是撤不回来的。
//
// 卡只负责「收」；「发」长在产出那份上，而且还要再确认一次。
export default function LetterCard({ letter, owner, onAdopted }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(false)

  async function go() {
    setBusy(true); setErr(null)
    try {
      await adoptLetter(owner, letter, letter.body)
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
        <span className="lcard-tag">这是一封信</span>
        {/* 收件人一直摆在脸上。发错人是这条路上唯一撤不回来的错，
            所以从这张卡起，那个地址就不许藏起来。 */}
        <span className="lcard-to">给 {letter.to}</span>
      </div>
      <div className="lcard-sub">{letter.subject}</div>
      {/* 信的全文摆在卡里，不摆在上面那段话里。
          两处都写的话，你改了上面那份、发出去的却是这份——而你不会察觉。 */}
      <div className="lcard-body md"><Md>{letter.body}</Md></div>
      {err && <div className="lcard-err">{err}</div>}
      {done ? (
        <div className="lcard-ok">
          收进产出了 —— 去右栏改完再发。<b>这儿不发信。</b>
        </div>
      ) : (
        <button className="lnk" disabled={busy} onClick={go}>
          {busy ? '收着……' : '收进产出（去那儿改完再发）'}
        </button>
      )}
    </div>
  )
}
