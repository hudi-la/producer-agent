import { md, day } from '../lib/when.js'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { fetchContactMessages } from '../lib/chat.js'
import { cuesFor } from '../lib/cues.js'
import Md from './Md.jsx'
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
  const [touching, setTouching] = useState(false)   // 「刚聊过」展开了输入
  const [touchText, setTouchText] = useState('')
  const taRef = useRef(null)
  const [claim, setClaim] = useState('')
  const [allMail, setAllMail] = useState(false)   // 往来展开了没有
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

  // 两个去处，没有第三个：
  //
  //   往来（左栏）  = 跟**这个人**真实来往过的每一次。邮件是一次，
  //                  见面/通话/微信聊了也是一次——只是渠道不同。
  //   商量（中栏）  = 你跟 **Fairwind** 说的话。它不是往来。
  //
  // 一开始把「记一笔」塞进了中栏，理由是 Dossier 那条规矩：「只把邮件收进
  // 卷宗，线下备注留在中栏的时间线里」。那条规矩是**机会线**的——那儿中栏
  // 是这条线的叙事。搬到人身上就给出了错答案：跟人见了一面，那是往来，
  // 不是叙事。于是往来那栏缺了半截，中栏多出两张不知道算什么的卡片。
  //
  // role='artist' 两种情况都有（你发的邮件、你跟 Fairwind 说的话），
  // 所以判据是「有没有 gmail_message_id」而不是 role。
  const mails = (msgs || []).filter((m) => m.gmail_message_id || m.role === 'note')
  // 往来会很长（Stacy 名下 59 封）。默认只摆最近 10 条，早的折起来。
  // 顺序不动——还是老的在上、新的在下，跟邮件线程和中栏一致。
  // 「更早的」那个按钮放在**最上面**：折起来的东西在哪儿，按钮就该在哪儿。
  const MAIL_HEAD = 10
  const hidden = Math.max(0, mails.length - MAIL_HEAD)
  const shownMails = allMail ? mails : mails.slice(-MAIL_HEAD)
  const talk  = (msgs || []).filter((m) => !m.gmail_message_id && m.role !== 'note')
  const cues  = cuesFor(c, msgs || [], { introName: c.intro_by_name })

  // 「上次碰」光有日期是没用的。「8/10 · 你记的一笔」等于没说——
  // 你想知道的是**上次到底发生了啥**：哪封信说了什么、那次见面聊了什么。
  //
  // 所以把产生那个日期的那条记录找出来，把它那句话摆上去。
  // 对不上日子的（你按了「聊过了」但没写内容）就老实说没记内容，
  // 不拿一句「你记的一笔」糊弄过去。
  const touches = (msgs || []).filter((m) => m.gmail_message_id || m.role === 'note')
  const lastTouch = touches.length ? touches[touches.length - 1] : null
  const touchShown = lastTouch && c.last_touch_at && day(lastTouch.created_at) === c.last_touch_at
    ? lastTouch : null

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

  /**
   * 记一次接触。**这是「往来」，不是「关系记忆」。**
   *
   * 两件事本来混在一个「记一笔」按钮里，于是时间线上多出些不知道算什么的卡片：
   *   · 一次接触（8/13 跟他通了话，聊了申请的事）→ 有时间、有先后，归时间线，
   *     并且它就是「上次碰」那个日期的来源
   *   · 对他的认识（他在找能一起做影像的人）→ 累积的、会被改写，归左栏关系记忆
   *
   * 不让 AI 猜这两者：判错的代价是记忆被污染，而这个区别你一眼就知道。
   */
  const logTouch = async (t, after) => {
    if (!t.trim() || busy) return
    setBusy('talk')
    try { await logMeet(c.id, t.trim()); await reload(); onChanged?.(); after?.() }
    catch (e) { alert('没记上：' + e.message) } finally { setBusy(null) }
  }
  const jot = () => logTouch(text, () => setText(''))

  // 「刚聊过」：**一定顺手写一句**。空打卡只留一个日期，
  // 而一个说不出内容的日期正是「上次碰」原来那么难用的原因。
  const doTouch = async () => {
    const t = touchText.trim()
    if (t) await logTouch(t, () => { setTouchText(''); setTouching(false) })
    else { await checkin(c.id); onChanged?.(); setTouching(false) }
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
          {/* 上次碰：日期 + 渠道 + **那一次说了什么**。
              只有日期的话（「8/10 · 你记的一笔」）等于没说，你还得自己去翻。 */}
          <div className="pf-cell">
            <div className="pf-k">上次碰</div>
            {c.last_touch_at ? (
              <>
                <div className="pf-v">
                  {md(c.last_touch_at)}
                  <span className="pf-note"> · {SRC[c.last_touch_src] || '来源不明'}</span>
                </div>
                {touchShown
                  ? <div className="pf-touch">{touchShown.content}</div>
                  : <div className="pf-touch none">这次没记内容——只按了「聊过了」</div>}
              </>
            ) : <div className="pf-empty">还没碰过</div>}

            {/* 微信 / 电话 / 线下系统看不见，靠你这一下。但**一定顺手写一句**：
                空打卡只留个日期，而说不出内容的日期正是上面那行原来那么难用的原因。 */}
            {touching ? (
              <div className="pf-field">
                <input autoFocus value={touchText} placeholder="刚才聊了什么？一句话"
                       onChange={(e) => setTouchText(e.target.value)}
                       onKeyDown={(e) => {
                         if (e.key === 'Escape') { setTouchText(''); setTouching(false) }
                         if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); doTouch() }
                       }} />
                <button className="lnk" onClick={doTouch} disabled={busy === 'talk'}>记下</button>
              </div>
            ) : (
              <button className="lnk pf-inline" onClick={() => setTouching(true)}>刚聊过</button>
            )}
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
                   {hidden > 0 && (
                     <button className="lnk pf-more" onClick={() => setAllMail((v) => !v)}>
                       {allMail ? `收起早的（只看最近 ${MAIL_HEAD} 条）` : `还有 ${hidden} 条更早的 · 展开`}
                     </button>
                   )}
                   {shownMails.map((m) => (
                     <div key={m.id} className={'pf-msg' + (m.role === 'note' ? ' note' : '')}>
                       <div className="pf-who">
                         {m.role === 'note' ? '你记的' : m.role === 'artist' ? '你' : (m.meta?.from_name || '对方')}
                         <span className="pf-note"> · {day(m.created_at)}</span>
                         {m.role === 'note' && <span className="pf-tag">当面 / 电话 / 微信</span>}
                       </div>
                       <div className="pf-body sm">{m.content}</div>
                     </div>
                   ))}
                 </div>
               )}
          </div>
        </aside>

        {/* ── 中 · 跟 Fairwind 商量 ─────────────────────────────
            对话自己滚（.focus-scroll），顶栏和左右两栏不跟着走——
            跟机会线详情页一个结构。以前没这层，聊长了整页一起滚，
            左边那张名片和右边的草稿全被推出视野。 */}
        <section className="fc-m">
          <div className="focus-scroll">
            <div className="focus-inner">
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
                talk.map((m) => {
                  // 谁在说话得说准，跟机会线那边一个判据。
                  const mine = m.role === 'artist'
                  const isNote = m.role === 'note'
                  return (
                    <div key={m.id} className={'msg' + (mine ? ' you' : isNote ? ' note' : ' producer')}>
                      <span className="who">
                        {isNote ? '你记的一次接触' : mine ? '你' : 'Fairwind'}
                        <span className="viamail"> · {md(m.created_at)}</span>
                      </span>
                      {/* 库里存的是 markdown。不渲的话「**这一类事**」在页面上
                          就是四个星号明晃晃摆着——同一份内容在机会线上是粗体，
                          在这儿是乱码，丑的那个看起来像坏了。 */}
                      <div className="bubble md"><Md>{m.content}</Md></div>
                    </div>
                  )
                })
              ) : (
                <p className="pf-note">还没跟 Fairwind 商量过什么。下面说一句。（跟他本人的来往在左栏）</p>
              )}

              {busy === 'talk' && (
                <div className="msg producer">
                  <span className="who">Fairwind</span>
                  <div className="bubble thinking"><i /><i /><i /></div>
                </div>
              )}

              {/* 同一个框两个去处，说清楚区别，别让你猜：
                  一次接触有时间有先后 → 时间线；对他的认识是累积的 → 左栏关系记忆。 */}
              <p className="pf-howto">
                回车 = 跟 <b>Fairwind</b> 商量（这一栏只装商量，不算往来）。
                <br />线下见了面、通了电话、微信聊了？
                <button className="lnk" onClick={jot}
                        disabled={busy === 'talk' || !text.trim()}>记进往来</button>
                ——它跟邮件一样是一次真实来往，进<b>左栏的往来</b>，并把「上次碰」记成今天。
                <br />他在找什么、答应过什么这类<b>认识</b>，写进左栏的<b>关系记忆</b>——那儿是累积的。
              </p>
            </div>
          </div>

          {/* 输入框跟机会线那个一模一样：浮在底部、一行装不下自己长高、
              Enter 发送 Shift+Enter 换行。isComposing 那句不能删——
              中文输入法选词也敲 Enter，不挡的话你选个词就把半句话发出去了。 */}
          <div className="composer">
            <textarea
              ref={taRef}
              className="ph"
              rows={1}
              value={text}
              disabled={busy === 'talk'}
              placeholder={busy === 'talk'
                ? 'Fairwind 在想……（想完会自动出现，你不用守着）'
                : '一起想点什么…… Fairwind 带着这个人的全部往来，你不用重讲'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
                e.preventDefault()
                say()
              }}
            />
            <button className="send" aria-label="发送" onClick={say}
                    disabled={busy === 'talk' || !text.trim()}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M8 13V3M8 3 4.5 6.5M8 3l3.5 3.5" stroke="#fff" strokeWidth="1.6"
                      strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
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
