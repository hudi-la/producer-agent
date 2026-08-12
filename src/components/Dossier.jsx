import React, { useEffect, useState } from 'react'
import Cast from './Cast.jsx'
import { fetchPursuitMail } from '../lib/pursuitCast.js'
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

/** 跟这些人的**其他**往来：跟这条线没关系，但也不该消失。默认折着。 */
function Aside({ items, onJump }) {
  const [open, setOpen] = useState(false)
  const who = [...new Set(items.map((m) => m.who).filter(Boolean))]
  return (
    <div className="aside">
      <button className="lnk aside-t" onClick={() => setOpen((o) => !o)}>
        {open ? '收起' : `还有 ${items.length} 封跟${who.slice(0, 2).join('、')}${who.length > 2 ? '等' : ''}的其他往来`}
      </button>
      {open && <div className="mails">{items.map((m) => <Mail m={m} key={m.id} onJump={onJump} />)}</div>}
    </div>
  )
}

function Mail({ m, onJump }) {
  const [open, setOpen] = useState(false)
  const mine = m.role === 'artist'
  const hasRaw = !!m.body_raw
  return (
    <div id={'dmail-' + m.id} className={'mail' + (open ? ' open' : '')}>
      <div className="mail-top">
        {/* 推导来的那些没有 meta.from_name（它们没经过 /sync 那条路），
            但视图给了 who。缺了就退回「对方」，不留空。 */}
        <span className={'who ' + (mine ? 'you' : 'org')}>{mine ? '你' : (m.meta?.from_name || m.who || '对方')}</span>
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

const fmtSize = (b) => {
  if (!b && b !== 0) return ''
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'
  return (b / 1048576).toFixed(1) + ' MB'
}

// 文件格。传进来、点开、删掉，都在这一小块里。
//
// 「传」用 label 包一个隐藏的 input——原生的文件选择框长得跟这一栏里
// 任何东西都不像，而且样式改不动。
function Files({ items, onUpload, onOpen, onDelete }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [over, setOver] = useState(false)

  async function take(fileList) {
    const fs = [...(fileList || [])]
    if (!fs.length) return
    setErr(null)
    setBusy(true)
    try {
      // 一份一份传，不并发：并发时某一份失败，你看不出是哪一份。
      for (const f of fs) await onUpload?.(f)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={'files' + (over ? ' over' : '')}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false) }}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
    >
      {items.map((a) => (
        <div className="file" key={a.id}>
          <span className="fi" aria-hidden="true">
            {(a.filename.split('.').pop() || '?').slice(0, 3).toUpperCase()}
          </span>
          <span className="body">
            <b>{a.filename}</b>
            <span className="m">
              {fmtSize(a.bytes)}
              {a.source === 'mail' || a.from_msg ? ' · 从一封信的附件来' : ''}
            </span>
          </span>
          <span className="acts">
            <button className="lnk" onClick={() => onOpen?.(a)}>打开</button>
            <button
              className="lnk del"
              onClick={() => { if (confirm(`删掉《${a.filename}》？桶里那份字节也一起没了，撤不回来。`)) onDelete?.(a) }}
            >
              删
            </button>
          </span>
        </div>
      ))}
      <label className={'fdrop' + (busy ? ' busy' : '')}>
        <input
          type="file"
          multiple
          disabled={busy}
          onChange={(e) => { take(e.target.files); e.target.value = '' }}
        />
        {busy ? '传着……' : items.length ? '+ 再丢一份（也可以直接拖进来）' : '把 PDF / MD / Excel 拖进来，或点这儿选'}
      </label>
      {err && <div className="ferr">{err}</div>}
    </div>
  )
}

export default function Dossier({
  p, msgs = [], files = [], attachments = [], onUnfinal, onJump, onSync, syncing, syncNote,
  onUpload, onOpenFile, onDeleteFile, onOpenPerson,
}) {
  // 这条线的往来现在是**推导**出来的：挂在它名下那些人的邮件。
  // 原来只认盖了 pursuit_id 的信，于是 Brooke 回了信这条线上还是 0 封。
  // castV 只是个计数器——挂/摘完人要重拉一次。
  const [derived, setDerived] = useState(null)
  const [castV, setCastV] = useState(0)
  useEffect(() => {
    let alive = true
    fetchPursuitMail(p.id).then((d) => { if (alive) setDerived(d) }).catch(() => {})
    return () => { alive = false }
  }, [p.id, castV])
  const stars = p.match_stars ? '★'.repeat(p.match_stars) : null
  // 只把邮件收进卷宗。线下备注（note / decision）留在中栏的时间线里——
  // 它们是这条线的叙事，两边都放就成了重复，而重复比缺失更难发现。
  // 两个来源合起来去重：盖过 pursuit_id 的老信 + 推导出来的。
  // 一封信可能两边都有，按 gmail_message_id 认；没有 id 的按行 id 认。
  const own = msgs.filter((m) => m.kind === 'email')
  const seen = new Set(own.map((m) => m.gmail_message_id || m.id))
  const extra = (derived || []).filter((m) => !seen.has(m.gmail_message_id || m.id))
  const all = [...own.map((m) => ({ ...m, on_this_line: true })), ...extra]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const mails = all.filter((m) => m.on_this_line)
  const aside = all.filter((m) => !m.on_this_line)
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

      <Cast pursuitId={p.id} onOpenPerson={onOpenPerson} onChanged={() => setCastV((v) => v + 1)} />

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
            <p className="empty">暂时没有。上面「相关的人」挂一个人上来，
              跟他的往来就会长在这儿。</p>
          ) : (
            <div className="mails">
              {mails.map((m) => <Mail m={m} key={m.id} onJump={onJump} />)}
            </div>
          )}
          {/* 别的线的往来折起来。不藏——藏了就是「看不见 = 丢了」；
              也不摊开——摊开这条线就混着别的项目的事。 */}
          {aside.length > 0 && <Aside items={aside} onJump={onJump} />}
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
        {/* 这一格永远在，哪怕一份都没有——原来是「有附件才显示」，
            于是「往这条线丢个文件」这件事在界面上根本不存在，你无从发现。 */}
        <Pool title="附件" count={attachments.length ? `${attachments.length} 份` : '空'}>
          <Files
            items={attachments}
            onUpload={onUpload}
            onOpen={onOpenFile}
            onDelete={onDeleteFile}
          />
        </Pool>
      </div>
    </div>
  )
}
