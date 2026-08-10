import React, { useState, useEffect, useCallback } from 'react'
import { fetchContactMessages } from '../lib/chat.js'
import { cuesFor } from '../lib/cues.js'
import {
  upsertContact, claimThread, logMeet, checkin, markIntroThanked,
  fetchThreads, fetchContactDeliverables,
  refreshContact, sayToContact, draftToGmail,
} from '../lib/people.js'

// 名片 —— 人这一层的详情页。
//
// 三栏跟机会线**逐格对齐**，一格都不错位：
//   左 fc-l  卷宗：他是谁 + 往来（只收邮件）+ 收信
//   中 fc-m  跟 Fairwind 商量（你记的一笔也在这条时间线上）
//   右 fc-r  要发的信
//
// 邮件归左、备注归中，这条规矩是 Dossier.jsx 定的：
// 「只把邮件收进卷宗。线下备注留在中栏的时间线里——两边都放就成了重复，
//   而重复比缺失更难发现。」
//
// **没有过卡。** 由头在列表页上就是一行字，看见了点进来办，
// 不需要再排成一摞让你一张张翻。

const SRC = { email: '来自那封信', checkin: '你打的卡', meet: '你记的一笔' }
const CH  = { email: '邮箱', wechat: '微信', sms: '短信', whatsapp: 'WhatsApp', ig: 'IG', phone: '电话' }
const md = (s) => {
  if (!s) return null
  const [, m, d] = String(s).split('-')
  return `${Number(m)}/${Number(d)}`
}
const day = (t) => (t ? String(t).slice(0, 10) : '?')

/** 名片上一格：点一下能改，回车存。只发改动那一格（RPC 里 null 的字段一概不动）。 */
function Cell({ label, value, placeholder, onSave, type = 'text', multiline = false }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value ?? '')
  useEffect(() => { setV(value ?? '') }, [value])
  const save = async () => {
    setEditing(false)
    if ((v ?? '') === (value ?? '')) return
    try { await onSave(v) } catch (e) { alert('没存上：' + e.message) }
  }
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <div className="pf-cell">
      <div className="pf-k">{label}</div>
      {editing ? (
        <Tag autoFocus type={multiline ? undefined : type} value={v} placeholder={placeholder}
             rows={multiline ? 3 : undefined}
             onChange={(e) => setV(e.target.value)}
             onBlur={save}
             onKeyDown={(e) => {
               if (e.key === 'Escape') { setV(value ?? ''); setEditing(false) }
               if (e.key === 'Enter' && !multiline) { e.preventDefault(); e.currentTarget.blur() }
             }} />
      ) : (
        <button className="pf-v" onClick={() => setEditing(true)}>
          {value || <span className="pf-empty">{placeholder}</span>}
        </button>
      )}
    </div>
  )
}

export default function PersonFocus({ person, onBack, onChanged, onOpenPursuit }) {
  const c = person
  const [msgs, setMsgs] = useState(null)
  const [threads, setThreads] = useState([])
  const [dels, setDels] = useState([])
  const [busy, setBusy] = useState(null)      // 'sync' | 'talk' | 'gmail' | null
  const [text, setText] = useState('')
  const [claim, setClaim] = useState('')
  const [note, setNote] = useState(null)      // 收信结果那句实话

  const reload = useCallback(async () => {
    const [m, t, d] = await Promise.all([
      fetchContactMessages(c.id), fetchThreads(c.id), fetchContactDeliverables(c.id),
    ])
    setMsgs(m || [])
    setThreads(t)
    setDels(d)
  }, [c.id])
  useEffect(() => { reload() }, [reload])

  // 邮件归左边卷宗，跟 Fairwind 的商量 + 你记的一笔归中栏。两边都放就成了重复。
  const mails = (msgs || []).filter((m) => m.gmail_message_id)
  const talk  = (msgs || []).filter((m) => !m.gmail_message_id)
  const cues  = cuesFor(c, msgs || [], { introName: c.intro_by_name })

  const save = async (patch) => { await upsertContact({ id: c.id, ...patch }); onChanged?.() }

  const doSync = async () => {
    if (busy) return
    setBusy('sync'); setNote(null)
    try {
      const out = await refreshContact(c.id)
      await reload(); onChanged?.()
      // 收信结果必须说出来，尤其是「没有新信」和「无处可收」——
      // 静默是最坏的：你分不清它查过了还是根本没查。
      setNote(out.note || (out.added
        ? `收到 ${out.added} 封新信${out.anchored ? `；他说的日子记下了（${out.next_touch_at}）` : ''}`
        : '查过了，没有新信'))
    } catch (e) { setNote('收信失败：' + e.message) } finally { setBusy(null) }
  }

  const say = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy('talk'); setText('')
    try { await sayToContact(c.id, t); await reload() }
    catch (e) { alert(e.message); setText(t) } finally { setBusy(null) }
  }

  const jot = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy('talk'); setText('')
    try { await logMeet(c.id, t); await reload(); onChanged?.() }
    catch (e) { alert('没记上：' + e.message); setText(t) } finally { setBusy(null) }
  }

  const toGmail = async (id) => {
    if (busy) return
    setBusy('gmail')
    try {
      const out = await draftToGmail(id)
      await reload()
      alert(`放进草稿箱了${out.to ? `（收信人 ${out.to}）` : ''}。去 Gmail 里改完按发送——系统没有发送这个能力。`)
    } catch (e) { alert(e.message) } finally { setBusy(null) }
  }

  const channels = (Array.isArray(c.channels) && c.channels.length)
    ? c.channels : (c.email ? [{ kind: 'email', value: c.email }] : [])

  return (
    <div className="focus page">
      {/* 必须包在 .focus-top 里：三栏的高度是 .focus 这个 flex 列分下来的，
          头部漏了这层，.focus-cols 就拿不到 flex:1，整个版面塌成一坨。 */}
      <div className="focus-top">
        <div className="ft-head">
          <button className="back" onClick={onBack}>
            <span aria-hidden="true">←</span><span className="t"> 全部联系人</span>
          </button>
          <h1 className="ft-title" title={c.name}>{c.name || '未具名联系人'}</h1>
        </div>
      </div>

      <div className="focus-cols">

        {/* ── 左 · 卷宗：他是谁 + 往来 ─────────────────────────── */}
        <aside className="fc-l">
          {/* 机构：一个人可以待过好几个。**离开了的不删**，标上到哪天为止——
              「她以前在 CultureHub」是真事，而且正是它解释了为什么
              stacy@culturehub.org 那几封信是她的。 */}
          <div className="pf-cell">
            <div className="pf-k">机构</div>
            {(c.orgs?.length ? c.orgs : [null]).map((o, i) => o ? (
              <div key={i} className={'pf-v pf-hist' + (o.until ? ' past' : '')}>
                {o.org}{o.role ? <span className="pf-note"> · {o.role}</span> : null}
                {o.until && <span className="pf-past-tag">到 {o.until} 为止</span>}
                {!o.until && o.since && <span className="pf-note"> · {o.since} 起</span>}
              </div>
            ) : <div key={i} className="pf-empty">没填</div>)}
          </div>

          {/* 邮箱：一个人会换。**停用的留着**——旧地址是历史往来的钥匙，
              删了那些信就再也认不回来。 */}
          <div className="pf-cell">
            <div className="pf-k">邮箱</div>
            {(c.emails?.length ? c.emails : [null]).map((e, i) => e ? (
              <div key={i} className={'pf-v pf-hist' + (e.until ? ' past' : '')}>
                <span className="pf-mail">{e.email}</span>
                {e.is_primary && !e.until && <span className="pf-now-tag">在用</span>}
                {e.until && <span className="pf-past-tag">⛔ {e.until} 起停用</span>}
                {e.note && <div className="pf-note">{e.note}</div>}
              </div>
            ) : <div key={i} className="pf-empty">没填</div>)}
          </div>

          <div className="pf-cell">
            <div className="pf-k">别的渠道</div>
            <div className="pf-chips">
              {channels.length
                ? channels.map((x, i) => (
                    <span key={i} className="pchip" title={x.value}>{CH[x.kind] || x.kind}</span>))
                : <span className="pf-empty">只有邮箱</span>}
            </div>
          </div>

          {/* Warm intro 的闭环：过阵子单独回介绍人一句。大多数人不做这一步。 */}
          {c.intro_by && (
            <div className="pf-cell">
              <div className="pf-k">谁介绍的</div>
              <div className="pf-v">
                {c.intro_by_name || '（库里那个人）'}
                {c.intro_thanked_at
                  ? <span className="pf-note"> · {md(c.intro_thanked_at)} 回谢过了</span>
                  : <button className="lnk pf-inline"
                            onClick={async () => { await markIntroThanked(c.id); onChanged?.() }}>
                      回谢了
                    </button>}
              </div>
            </div>
          )}

          {/* 日期永远说得出出处。没有来源的日期是来路不明的数字。 */}
          <div className="pf-cell">
            <div className="pf-k">上次碰</div>
            <div className="pf-v">
              {c.last_touch_at
                ? <>{md(c.last_touch_at)}<span className="pf-note"> · {SRC[c.last_touch_src] || '来源不明'}</span></>
                : <span className="pf-empty">还没碰过</span>}
              {/* 微信 / 电话 / 线下系统看不见 —— 它不知道就不假装知道，靠你这一下。 */}
              <button className="lnk pf-inline"
                      onClick={async () => { await checkin(c.id); onChanged?.() }}>聊过了</button>
            </div>
          </div>

          <Cell label="下次碰" value={c.next_touch_at} placeholder="没定" type="date"
                onSave={(v) => save({ next_touch_at: v || null,
                                      next_touch_why: v ? '你自己定的' : null })} />
          {c.next_touch_why && <div className="pf-note pf-why">{c.next_touch_why}</div>}

          <Cell label="关系记忆" multiline value={c.notes}
                placeholder="他关心什么、答应过什么、上回聊了什么"
                onSave={(v) => save({ notes: v })} />

          {cues.length > 0 && (
            <div className="pf-cues">
              {cues.map((q) => (
                <div key={q.via} className={'pcue-tag' + (q.stopped ? ' stopped' : '')}>{q.why}</div>
              ))}
            </div>
          )}

          {/* ── 往来。只收邮件，备注在中栏。 ── */}
          <div className="pf-sect">
            <div className="pf-sect-h">
              <span>往来</span>
              <button className="lnk" onClick={doSync} disabled={busy === 'sync'}
                      title="去 Gmail 拉这个人认领过的往来的新信">
                {busy === 'sync' ? '收信中…' : '收信'}
              </button>
            </div>
            <div className="pf-note">
              认领了 {threads.length} 条{threads.length ? '' : ' —— 认领一条才收得到信'}
            </div>
            {note && <div className={'pf-syncnote' + (note.startsWith('收信失败') ? ' bad' : '')}>{note}</div>}

            <div className="pf-field">
              <input placeholder="贴 Gmail thread id" value={claim}
                     onChange={(e) => setClaim(e.target.value)} />
              <button className="lnk" disabled={!claim.trim()}
                      onClick={async () => {
                        try { await claimThread(c.id, claim.trim()); setClaim(''); await reload() }
                        catch (e) { alert('没认上：' + e.message) }
                      }}>认领</button>
            </div>

            {msgs === null ? <p className="pf-note">读着…</p>
             : mails.length === 0
               ? <p className="pf-note">还没有往来。认领一条 thread，或者起草一封发出去，它就接上了。</p>
               : (
                 <div className="pf-msgs">
                   {mails.map((m) => (
                     <div key={m.id} className="pf-msg">
                       <div className="pf-who">
                         {m.role === 'artist' ? '你' : (m.meta?.from_name || '对方')}
                         <span className="pf-note"> · {day(m.created_at)}</span>
                       </div>
                       <div className="pf-body sm">{m.content}</div>
                     </div>
                   ))}
                 </div>
               )}
          </div>
        </aside>

        {/* ── 中 · 跟 Fairwind 商量 ───────────────────────────── */}
        <section className="fc-m">
          {/* 「人是独立一层、两区共用同一张名片」看得见的样子 */}
          {c.pursuits?.length > 0 && (
            <div className="pf-lines">
              <span className="pf-k">他挂着的机会线</span>
              {c.pursuits.map((p) => (
                <button key={p.id} className="lnk" onClick={() => onOpenPursuit?.(p.id)}>{p.title}</button>
              ))}
            </div>
          )}

          {talk.length ? (
            <div className="pf-msgs">
              {talk.map((m) => (
                <div key={m.id} className={'pf-msg' + (m.role === 'note' ? ' note' : '')}>
                  <div className="pf-who">
                    {m.role === 'note' ? '你记的一笔' : m.role === 'artist' ? '你' : 'Fairwind'}
                    <span className="pf-note"> · {day(m.created_at)}</span>
                  </div>
                  <div className="pf-body">{m.content}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="pf-note">还没商量过什么。下面说一句，或者记一笔线下见面。</p>
          )}

          {busy === 'talk' && <p className="pf-note">Fairwind 在想…</p>}

          <div className="pf-say">
            <textarea rows={2} value={text} placeholder="跟 Fairwind 说一句…"
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); say() }
                      }} />
            <div className="pf-say-btns">
              <button className="lnk" onClick={say} disabled={busy || !text.trim()}>说</button>
              <button className="lnk" onClick={jot} disabled={busy || !text.trim()}>记一笔</button>
            </div>
          </div>
          <p className="pf-note">
            「说」= 让它想（⌘↵）；「记一笔」= 直接落进上面这条时间线，
            并把「上次碰」记成今天——线下见了面按这个。
          </p>
        </section>

        {/* ── 右 · 要发的信 ───────────────────────────────────── */}
        <aside className="fc-r">
          <div className="pf-sect-h"><span>要发的信</span></div>
          {dels.length === 0 ? (
            <p className="pf-note">
              还没有要发的信。在中栏跟 Fairwind 说「帮我回他」，它写的草稿会出现在这儿。
            </p>
          ) : dels.map((d) => (
            <div key={d.id} className="pf-del">
              <div className="pf-who">
                {d.title}
                <span className="pf-tag">{d.status === 'final' ? '已定稿' : '草稿'}</span>
              </div>
              <div className="pf-body">{d.body}</div>
              {/* 只建草稿，不发送 —— 不是我们关掉的，是 Gmail 连接器整套工具里就没有 send。
                  最后那下发送永远是你的手。 */}
              <button className="lnk" disabled={busy === 'gmail' || !d.body?.trim()}
                      onClick={() => toGmail(d.id)}>
                {d.meta?.gmail_draft_id ? '再放一次草稿箱' : '放进 Gmail 草稿箱'}
              </button>
              {d.meta?.gmail_draft_id && (
                <div className="pf-note">草稿箱里有一份。<b>发送要你自己在 Gmail 里按。</b></div>
              )}
            </div>
          ))}
        </aside>

      </div>
    </div>
  )
}
