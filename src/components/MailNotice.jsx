import React, { useState } from 'react'
import { md } from '../lib/when.js'
import { saidThisTime, GIST_CAP } from '../lib/letter.js'
import { t } from '../i18n/index.js'
import Veil from './Veil.jsx'

export default function MailNotice({ m }) {
  const [open, setOpen] = useState(false)
  const 进来的 = m.role === 'org'
  // 预约发送：你在 Gmail 里点了「安排发送」、还没到点的信。它会出现在
  // 这儿（信没藏——你得看得见自己排了什么），但**不能长得跟发出去的一样**：
  // 它还躺在队列里，可以取消，对方还没收到。到点之后自然变回「你发出」。
  // （Gmail 对这种信不给标签，收信那道「没 SENT 就拦」的闸摸空了——
  //   所以在这儿用时间说话：sent_at 在未来 = 还没发生。）
  const 预约中 = !进来的 && new Date(m.created_at) > new Date()
  const who = 进来的 ? (m.meta?.from_name || m.counterpart_email || t('对方'))
    : 预约中 ? t('预约发送 · 还没送出') : t('你发出')
  // **原文和摘要不是一回事，不许混着显示。**
  //
  // 库里有两种信：body_raw 是 Gmail 取回来的原文，content 有时候是人写的
  // 中文摘要。原来这儿写 `m.body_raw || m.content`，于是没存原文的那些
  // 直接把摘要摆出来、还没有「展开原文」——同一个框，有的是原文有的是摘要，
  // 你从外面看不出区别。
  //
  // （那 21 封没存原文的已经从 Gmail 补回来了。这道闸是给以后的：
  //   万一再有，框上得说出来。）
  const raw = m.body_raw || ''
  const 只有摘要 = !raw && Boolean(m.content)
  const body = raw || m.content || ''
  const head = saidThisTime(body)
  const 有更多 = Boolean(raw) && (head.length > GIST_CAP || raw.trim() !== head)
  return (
    <div id={'msg-' + m.id} className={'arrival' + (进来的 ? ' in' : ' out')}>
      <div className="arr-top">
        <span className="arr-mark" aria-hidden="true">✉</span>
        <b>{进来的 ? <><Veil>{who}</Veil>{t(' 来信')}</> : who}</b>
        {只有摘要 && <span className="arr-tag">{t('摘要 · 原文没存下来')}</span>}
        <span className="arr-when">{md(m.created_at)}</span>
      </div>
      <div className="arr-gist">{(head.slice(0, GIST_CAP) + (head.length > GIST_CAP || m.meta?.notification_excerpt ? '…' : '')) || t('（这封信没有正文）')}</div>
      {有更多 && (
        <button className="arr-more" onClick={() => setOpen((x) => !x)}>
          {open ? t('收起原文') : t('展开原文')} {open ? '▾' : '▸'}
        </button>
      )}
      {open && <pre className="arr-raw">{raw}</pre>}
    </div>
  )
}

