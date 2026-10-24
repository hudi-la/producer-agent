import React, { useState } from 'react'
import { md } from '../lib/when.js'
import { saidThisTime } from '../lib/letter.js'
import { t } from '../i18n/index.js'
import Veil from './Veil.jsx'
import MailNotice from './MailNotice.jsx'

// 「信到了」那条细线（2026-10-24）。
//
// 对话里一行小字：谁来信 / 你发出 · 日期 · 开头一句。它只是那封信的影子，不是一条消息——
// 原来人卡里它被画成 Fairwind 的气泡（你发出的信看起来像一条聊天），10/23 又被放大成整张邮件卡。
// 点一下展开那封信；再点收起。
export default function ArrivalLine({ m }) {
  const [open, setOpen] = useState(false)
  const 进来的 = m.role === 'org'
  const 预约中 = !进来的 && new Date(m.created_at) > new Date()
  const who = 进来的 ? (m.meta?.from_name || m.counterpart_email || t('对方')) : null
  const gist = saidThisTime(m.body_raw || m.content || '').replace(/\s+/g, ' ').trim()
  return (
    <div id={'msg-' + m.id} className={'arrline' + (进来的 ? ' in' : ' out')}>
      <button className="arrline-row" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <span className="arrline-mark" aria-hidden="true">✉</span>
        <span className="arrline-who">{进来的 ? <><Veil>{who}</Veil>{t(' 来信')}</> : 预约中 ? t('预约发送 · 还没送出') : t('你发出')}</span>
        <span className="arrline-when">{md(m.created_at)}</span>
        {gist && <span className="arrline-gist">{gist}</span>}
      </button>
      {open && <MailNotice m={m} />}
    </div>
  )
}
