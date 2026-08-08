import React, { useState } from 'react'
import Pool from './Pool.jsx'
import { heldLabel, useProfile } from '../lib/profile.js'

// 左栏：卷宗。
//
// 三栏三种性质——左边是**素材**，中间是**商量**，右边是**交付**。
//
// 邮件放这儿、不混进中间的对话，是因为：你和 Fairwind 商量是可撤销的，
// 你和机构的信是不可撤销的。两种东西混在一条流里人会看错——这个错已经犯过了
// （role='org' 的来信在界面上全挂着 Fairwind 的名字）。

const srcLabel = (s) => (s === 'manual' ? '你丢的' : 'scout')
const PAYOFF = { paid: '给钱', access: '给圈子', both: '钱 + 圈子' }

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(+d)) return String(s)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function Mail({ m, onJump }) {
  const [open, setOpen] = useState(false)
  const mine = m.role === 'artist'
  const hasRaw = !!m.body_raw
  return (
    <div id={'dmail-' + m.id} className={'mail' + (open ? ' open' : '')}>
      <div className="mail-top">
        <span className={'who ' + (mine ? 'you' : 'org')}>{mine ? '你' : (m.meta?.from_name || '对方')}</span>
        <span className="when">{fmtDate(m.created_at)}</span>
        {m.meta?.unanswered && <span className="flag">未回</span>}
      </div>
      <div className="mail-sum">{m.content}</div>
      <div className="mail-acts">
        {hasRaw && (
          <button className="lnk" onClick={() => setOpen((o) => !o)}>
            {open ? '收起 ▴' : '原文 ▾'}
          </button>
        )}
        {onJump && <button className="lnk" onClick={() => onJump(m.id)}>在时间线上定位</button>}
      </div>
      {open && hasRaw && (
        <div className="mail-full">
          {m.meta?.subject && <div className="hdr">{m.meta.subject}</div>}
          {m.body_raw}
        </div>
      )}
    </div>
  )
}

export default function Dossier({ p, msgs = [], files = [], attachments = [], onUnfinal, onJump, onSync, syncing, syncNote }) {
  const stars = p.match_stars ? '★'.repeat(p.match_stars) : null
  // 只把邮件收进卷宗。线下备注（note / decision）留在中栏的时间线里——
  // 它们是这条线的叙事，两边都放就成了重复，而重复比缺失更难发现。
  const mails = msgs.filter((m) => m.kind === 'email')
  const failed = !!syncNote && syncNote.startsWith('收信失败')

  const profile = useProfile()

  const facts = [
    p.kind && ['类型', p.kind],
    p.org && ['机构', p.org],
    p.location && ['地点', p.location],
    p.opens_at && ['开放', p.opens_at],
    p.funding && ['资助', p.funding],
    p.payoff && ['回报', PAYOFF[p.payoff] || p.payoff],
    stars && ['匹配', stars],
    ['来源', srcLabel(p.source)],
  ].filter(Boolean)

  return (
    <div className="dossier">
      {/* 不是每条线都有的提醒。它们是这条线特有的约束，所以留在这儿，
          不往卡头挤——卡头上只放每张卡都有的那两样（截止、球权）。 */}
      {p.next_touch_at && (
        <div className="cue">⏰ <b>{p.next_touch_at}</b> 该再碰一次</div>
      )}
      {!p.eligible && <div className="cue held">{heldLabel(profile)}</div>}

      <div className="dsect">
        <Pool title="事实" count={`${facts.length + (p.url ? 1 : 0)} 项`} defaultOpen>
          <div className="facts">
            {facts.map(([k, v]) => (
              <div className="fact" key={k}><i>{k}</i><span>{v}</span></div>
            ))}
            {p.url && (
              <div className="fact"><i>链接</i>
                <span><a href={p.url} target="_blank" rel="noreferrer">官方页面 ↗</a></span>
              </div>
            )}
          </div>
        </Pool>
      </div>

      <div className="dsect">
        <p className="secttl">往来</p>
        <Pool
          title="邮件"
          count={mails.length ? `${mails.length} 封` : '0 封'}
          defaultOpen={mails.length > 0}
          announce={syncNote}
          /* 收信按在标题行上：池子收着也能按。它只拉这条线登记过的 thread，
             不遍历你的信箱。 */
          action={
            <button className="poolbtn" onClick={onSync} disabled={syncing}
              title="去 Gmail 拉这条线的新信（只看这条线认领过的往来）">
              {syncing ? '收信中…' : '收信'}
            </button>
          }
        >
          {/* 「上次收信」必须写出来，失败更要写。静默失败是最坏的：
              你会以为没新信，其实是同步断了三天。 */}
          <p className={'syncnote' + (failed ? ' bad' : '')}>{syncNote || '还没收过这条线的信'}</p>
          {mails.length === 0 ? (
            <p className="empty">暂时没有。这条线还没认领任何邮件线索——
              有了往来，它会长在这儿。</p>
          ) : (
            <div className="mails">
              {mails.map((m) => <Mail m={m} key={m.id} onJump={onJump} />)}
            </div>
          )}
        </Pool>
      </div>

      {(p.contact_name || p.contact_role) && (
        <div className="dsect">
          <p className="secttl">人</p>
          <Pool title={p.contact_name || '对接人'} count="主对接" defaultOpen>
            <div className="person">
              <span className="avatar" aria-hidden="true" />
              <div>
                <div><b>{p.contact_name || '—'}</b></div>
                {p.contact_role && <div className="sub">{p.contact_role}</div>}
              </div>
            </div>
          </Pool>
        </div>
      )}

      <div className="dsect">
        <p className="secttl">文件</p>
        <Pool title="定稿" count={`${files.length} 份`} defaultOpen={files.length > 0}>
          {files.length === 0 ? (
            <p className="empty">还没有定稿的东西。右边定一份，这儿就多一份。</p>
          ) : (
            <div className="files">
              {files.map((d) => (
                <div className="file" key={d.id}>
                  <span className="fi" aria-hidden="true">{(d.kind || 'md').slice(0, 3).toUpperCase()}</span>
                  <span className="body">
                    <b>{d.title}</b>
                    <span className="m">
                      {d.finalized_at ? fmtDate(d.finalized_at) + ' 定稿' : '已定稿'}
                      {d.source ? ' · ' + d.source : ''}
                    </span>
                  </span>
                  <button className="undo" onClick={() => onUnfinal?.(d.id)} title="退回右栏继续改">
                    取消定稿
                  </button>
                </div>
              ))}
            </div>
          )}
        </Pool>
        {attachments.length > 0 && (
          <Pool title="附件" count={`${attachments.length} 份`}>
            <div className="files">
              {attachments.map((a) => (
                <div className="file" key={a.id}>
                  <span className="fi" aria-hidden="true">
                    {(a.filename.split('.').pop() || '?').slice(0, 3).toUpperCase()}
                  </span>
                  <span className="body">
                    <b>{a.filename}</b>
                    <span className="m">
                      {a.bytes ? (a.bytes / 1048576).toFixed(1) + ' MB' : ''}
                      {a.from_msg ? ' · 从一封信的附件来' : ''}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Pool>
        )}
      </div>
    </div>
  )
}
