import React, { useEffect, useState, useCallback } from 'react'
import { fetchContactMessages } from '../lib/chat.js'
import { cuesFor } from '../lib/cues.js'
import {
  upsertContact, claimThread, logMeet, checkin, markIntroThanked,
  fetchThreads, fetchContactDeliverables,
  refreshContact, sayToContact, draftToGmail,
} from '../lib/people.js'

// 名片 —— 人这一层的详情页。
//
// 不新造形状：复用 PursuitFocus 的三栏（fc-l / fc-m / fc-r），
// 连窄屏叠成一栏那套规则都直接生效。三栏在这儿的意思是：
//   左 = 他是谁　中 = 你们的往来　右 = 要发的信
//
// 中栏那句「他挂在哪几条机会线上」是重点 —— 这是「人是独立一层、两区共用
// 同一张名片」落地之后，你**看得见**的样子。

const SRC = { email: '来自那封信', checkin: '你打的卡', meet: '你记的一笔' }
const CH = { email: '邮箱', wechat: '微信', sms: '短信', whatsapp: 'WhatsApp', ig: 'IG', phone: '电话' }
const md = (s) => {
  if (!s) return null
  const [, m, d] = String(s).split('-')
  return `${Number(m)}/${Number(d)}`
}
const day = (t) => (t ? String(t).slice(0, 10) : '?')

/** 左栏一格：点一下能改，回车存。改一格只发这一格（RPC 里 null 的字段一概不动）。 */
function Cell({ label, value, placeholder, onSave, type = 'text' }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value ?? '')
  useEffect(() => { setV(value ?? '') }, [value])
  const save = async () => {
    setEditing(false)
    if ((v ?? '') === (value ?? '')) return
    try { await onSave(v) } catch (e) { alert('没存上：' + e.message) }
  }
  return (
    <div className="pf-cell">
      <div className="pf-k">{label}</div>
      {editing ? (
        <input autoFocus type={type} value={v} placeholder={placeholder}
               onChange={(e) => setV(e.target.value)}
               onBlur={save}
               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />
      ) : (
        <button className="pf-v" onClick={() => setEditing(true)}>
          {value || <span className="pf-empty">{placeholder}</span>}
        </button>
      )}
    </div>
  )
}

export default function PersonFocus({
  person, onChanged, onOpenPursuit,
  queue = null, onQueuePrev, onQueueNext, onQueueDone, onQueueLater,
}) {
  const [msgs, setMsgs] = useState(null)
  const [threads, setThreads] = useState([])
  const [dels, setDels] = useState([])
  const [busy, setBusy] = useState(null)     // 'refresh' | 'draft' | null
  const [meet, setMeet] = useState('')
  const [claim, setClaim] = useState('')

  const c = person

  const reload = useCallback(async () => {
    const [m, t, d] = await Promise.all([
      fetchContactMessages(c.id), fetchThreads(c.id), fetchContactDeliverables(c.id),
    ])
    setMsgs(m || [])
    setThreads(t)
    setDels(d)
  }, [c.id])

  useEffect(() => { reload() }, [reload])

  const cues = cuesFor(c, msgs || [], { introName: c.intro_by_name })

  const save = async (patch) => { await upsertContact({ id: c.id, ...patch }); onChanged?.() }

  const doRefresh = async () => {
    if (busy) return
    setBusy('refresh')
    try {
      const out = await refreshContact(c.id)
      await reload()
      onChanged?.()
      if (out.note) alert(out.note)
    } catch (e) { alert(e.message) } finally { setBusy(null) }
  }

  const doDraft = async () => {
    if (busy) return
    setBusy('draft')
    try {
      await sayToContact(c.id, '帮我起草一封回信。读一遍上面的往来，按他的语言写，带一个由头，别写纯问候。')
      await reload()
    } catch (e) { alert(e.message) } finally { setBusy(null) }
  }

  const toGmail = async (id) => {
    if (busy) return
    setBusy('draft')
    try {
      const out = await draftToGmail(id)
      await reload()
      alert(`放进草稿箱了。去 Gmail 里改完按发送——${out.to ? `收信人 ${out.to}` : '收信人在草稿里'}。`)
    } catch (e) { alert(e.message) } finally { setBusy(null) }
  }

  // 「你为什么在队里」钉在卡头上 —— 渲染了但你看不见，等于没渲染。
  const whyHere = queue?.via ? cues.find((q) => q.via === queue.via)?.why : null

  return (
    <div className="focus page">
      {queue && (
        <div className="focus-top pf-q">
          <button className="lnk" onClick={onQueuePrev} disabled={queue.i <= 0}>‹</button>
          <span className="pf-note">{queue.i + 1} / {queue.n}</span>
          <button className="lnk" onClick={onQueueNext} disabled={queue.i >= queue.n - 1}>›</button>
          {whyHere && <span className="pf-qwhy">{whyHere}</span>}
          {queue.skippedAt && <span className="pf-note">· {queue.skippedAt} 你先放着了</span>}
          <span className="sp" style={{ flex: 1 }} />
          <button className="lnk" onClick={onQueueLater}>再等一等</button>
          <button className="lnk" onClick={onQueueDone}>移出</button>
        </div>
      )}
      <div className="focus-cols">

        {/* ── 左：他是谁 ─────────────────────────────────── */}
        <aside className="fc-l">
          <h2 className="pf-name">{c.name || '未具名联系人'}</h2>

          <Cell label="机构" value={c.org} placeholder="没填" onSave={(v) => save({ org: v })} />
          <Cell label="他管什么" value={c.role} placeholder="没填" onSave={(v) => save({ role: v })} />
          <Cell label="邮箱" value={c.email} placeholder="没填" onSave={(v) => save({ email: v })} />

          <div className="pf-cell">
            <div className="pf-k">用什么找他</div>
            <div className="pf-chips">
              {(Array.isArray(c.channels) && c.channels.length
                ? c.channels
                : c.email ? [{ kind: 'email', value: c.email }] : []
              ).map((x, i) => (
                <span key={i} className="ppl-chip" title={x.value}>{CH[x.kind] || x.kind}</span>
              ))}
              {!c.channels?.length && !c.email && <span className="pf-empty">还不知道</span>}
            </div>
          </div>

          {/* 谁介绍的 + 回谢闭环。这一步大多数人不做，做了的人一直有人愿意介绍。 */}
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
                ? <>{md(c.last_touch_at)} <span className="pf-note">· {SRC[c.last_touch_src] || '来源不明'}</span></>
                : <span className="pf-empty">还没碰过</span>}
              {/* 微信 / 电话 / 线下系统看不见 —— 它不知道就不假装知道，靠你这一下。 */}
              <button className="lnk pf-inline"
                      onClick={async () => { await checkin(c.id); onChanged?.() }}>
                聊过了
              </button>
            </div>
          </div>

          <Cell label="下次碰" value={c.next_touch_at} placeholder="没定" type="date"
                onSave={(v) => save({ next_touch_at: v || null, next_touch_why: v ? '你自己定的' : null })} />
          {c.next_touch_why && <div className="pf-note pf-why">{c.next_touch_why}</div>}

          <Cell label="关系记忆" value={c.notes} placeholder="他关心什么、答应过什么、上回聊了什么"
                onSave={(v) => save({ notes: v })} />

          {cues.length > 0 && (
            <div className="pf-cues">
              {cues.map((q) => (
                <div key={q.via} className={`cue cue-${q.via}${q.stopped ? ' cue-stopped' : ''}`}>{q.why}</div>
              ))}
            </div>
          )}
        </aside>

        {/* ── 中：往来 ───────────────────────────────────── */}
        <section className="fc-m">
          {/* 「人是独立一层、两区共用」看得见的样子 */}
          {c.pursuits?.length > 0 && (
            <div className="pf-lines">
              <span className="pf-k">他挂着的机会线</span>
              {c.pursuits.map((p) => (
                <button key={p.id} className="lnk" onClick={() => onOpenPursuit?.(p.id)}>{p.title}</button>
              ))}
            </div>
          )}

          <div className="pf-tools">
            <button className="lnk" onClick={doRefresh} disabled={busy === 'refresh'}>
              {busy === 'refresh' ? '收着…' : '更新最新信息'}
            </button>
            <span className="pf-note">
              认领了 {threads.length} 条往来{threads.length ? '' : ' —— 认领一条才收得到信'}
            </span>
          </div>

          <div className="pf-claim">
            <input placeholder="贴一个 Gmail thread id，认领这条往来" value={claim}
                   onChange={(e) => setClaim(e.target.value)} />
            <button className="lnk" disabled={!claim.trim()}
                    onClick={async () => {
                      try { await claimThread(c.id, claim.trim()); setClaim(''); await reload() }
                      catch (e) { alert('没认上：' + e.message) }
                    }}>认领</button>
          </div>

          {msgs === null ? (
            <p className="pf-note">读着…</p>
          ) : msgs.length === 0 ? (
            <p className="pf-note">还没有往来。认领一条 Gmail thread，或者在下面记一笔。</p>
          ) : (
            <div className="pf-msgs">
              {msgs.map((m) => (
                <div key={m.id} className={`pf-msg pf-${m.role}`}>
                  <div className="pf-who">
                    {m.role === 'note' ? '你记的一笔'
                     : m.role === 'artist' ? '你'
                     : m.role === 'producer' ? 'Fairwind'
                     : (m.meta?.from_name || '对方')}
                    <span className="pf-note"> · {day(m.created_at)}</span>
                    {m.gmail_message_id && <span className="pf-tag">邮件</span>}
                  </div>
                  <div className="pf-body">{m.content}</div>
                </div>
              ))}
            </div>
          )}

          {/* 记一笔：一条记录同时干三件事 —— 更新「上次碰」、触发 48 小时由头、留下聊到哪。 */}
          <div className="pf-meet">
            <input placeholder="线下见了一面？记一笔（8/6 CalArts 开幕，聊了他在做的声音项目）"
                   value={meet} onChange={(e) => setMeet(e.target.value)} />
            <button className="lnk" disabled={!meet.trim()}
                    onClick={async () => {
                      try { await logMeet(c.id, meet.trim()); setMeet(''); await reload(); onChanged?.() }
                      catch (e) { alert('没记上：' + e.message) }
                    }}>记下</button>
          </div>
        </section>

        {/* ── 右：要发的信 ───────────────────────────────── */}
        <aside className="fc-r">
          <div className="pf-tools">
            <button className="lnk" onClick={doDraft} disabled={busy === 'draft'}>
              {busy === 'draft' ? '写着…' : '起草回信'}
            </button>
          </div>

          {dels.length === 0 ? (
            <p className="pf-note">还没有要发的信。「起草回信」让 Fairwind 写一版，你改完再定稿。</p>
          ) : dels.map((d) => (
            <div key={d.id} className="pf-del">
              <div className="pf-who">
                {d.title}
                <span className="pf-tag">{d.status === 'final' ? '已定稿' : '草稿'}</span>
              </div>
              <div className="pf-body">{d.body}</div>
              {/* 只建草稿，不发送 —— 不是我们关掉的，是 Gmail 连接器整套工具里就没有 send。
                  最后那下发送永远是你的手。 */}
              <button className="lnk" disabled={busy === 'draft' || !d.body?.trim()}
                      onClick={() => toGmail(d.id)}>
                {d.meta?.gmail_draft_id ? '再放一次草稿箱' : '放进 Gmail 草稿箱'}
              </button>
              {d.meta?.gmail_draft_id && (
                <span className="pf-note"> · 草稿箱里有一份，发送要你自己在 Gmail 里按</span>
              )}
            </div>
          ))}
        </aside>

      </div>
    </div>
  )
}
