import React, { useState } from 'react'
import { md } from '../lib/when.js'
import Veil from './Veil.jsx'

// 往来里的一条。**机会线的卷宗和人的名片共用这一份。**
//
// 两边装的是同一种东西——一次真实来往——所以不该长两个样子。
// 抄两遍的下场已经见过一次了：名片那边的粗体渲成了四个星号，
// 因为 Md 只活在 PursuitFocus 里。
//
// 一条往来有三层，摊开的程度依次递增：
//   摘要        永远看得见（一句话，Fairwind 写的）
//   原文 ▾      按了才展开（邮件全文，你可能删了 Gmail 里那封，库里这份是凭据）
//   在时间线上定位  跳到中栏对应那条（机会线那边有中栏时间线；名片没有，就不传）
export default function Mail({ m, onJump }) {
  const [open, setOpen] = useState(false)
  const mine = m.role === 'artist'
  const isNote = m.role === 'note'
  const hasRaw = !!m.body_raw
  const who = isNote ? '你记的' : mine ? '你' : (m.meta?.from_name || m.who || '对方')

  return (
    <div id={'dmail-' + m.id} className={'mail' + (open ? ' open' : '') + (isNote ? ' note' : '')}>
      <div className="mail-top">
        {/* 对方的名字要过展示模式；「你」「你记的」不是私人信息，不用过 */}
        <span className={'who ' + (isNote ? 'note' : mine ? 'you' : 'org')}>
          {isNote || mine ? who : <Veil>{who}</Veil>}
        </span>
        <span className="when">{md(m.created_at)}</span>
        {/* 不是邮件的那种得标出来源，否则你分不清这条是从信箱来的还是你自己写的 */}
        {isNote && <span className="flag soft">{m.meta?.how || '当面 / 电话 / 微信'}</span>}
        {m.meta?.unanswered && <span className="flag">未回</span>}
      </div>
      <div className="mail-sum">{m.content}</div>
      {(hasRaw || onJump) && (
        <div className="mail-acts">
          {hasRaw && (
            <button className="lnk" onClick={() => setOpen((o) => !o)}>
              {open ? '收起 ▴' : '原文 ▾'}
            </button>
          )}
          {onJump && <button className="lnk" onClick={() => onJump(m.id)}>在时间线上定位</button>}
        </div>
      )}
      {open && hasRaw && (
        <div className="mail-full">
          {m.meta?.subject && <div className="hdr">{m.meta.subject}</div>}
          {m.body_raw}
        </div>
      )}
    </div>
  )
}

/**
 * 「最新 m 条 / 全部 n 条」。
 *
 * 往来会很长（Stacy 名下 62 条）。全铺出来的话这一格成了读不完的带子，
 * 而你打开一张卡多半只想知道「最近怎么样了」。
 *
 * 顺序不动：老的在上、新的在下，跟邮件线程一致——条数变了，读法没变。
 * 按钮放在**最上面**：折起来的是更早的，它们在列表上方，按钮就该在那儿。
 */
export function MailList({ items, head = 3, onJump }) {
  const [all, setAll] = useState(false)
  if (!items.length) return null
  const hidden = Math.max(0, items.length - head)
  const shown = all ? items : items.slice(-head)
  return (
    <div className="mails">
      {hidden > 0 && (
        <button className="lnk pf-more" onClick={() => setAll((v) => !v)}>
          {all ? `只看最新 ${head} 条` : `还有 ${hidden} 条更早的 · 看全部 ${items.length} 条`}
        </button>
      )}
      {shown.map((m) => <Mail key={m.id} m={m} onJump={onJump} />)}
    </div>
  )
}
