import { md, day } from '../lib/when.js'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { fetchContactMessages, rewindChat } from '../lib/chat.js'
import { dropFrom } from '../lib/rewind.js'
import Md from './Md.jsx'
import SayBubble from './Resay.jsx'
import Pool from './Pool.jsx'
import DeskToggle from './DeskToggle.jsx'
import { MailList } from './Mail.jsx'
import { isLetter, isExchange } from '../lib/letter.js'
// 它写完一封信，对话里那条就渲染成一张信卡——点一下落进右栏「要发的信」。
import LetterCard from './LetterCard.jsx'
// 它填的是一张申请表——同一个路子，收进产出之后一格一格改。
import FormCard from './FormCard.jsx'
import { sendLetterNow } from '../lib/letters.js'
import {
  upsertContact, claimThread, logMeet, checkin, markIntroThanked,
  fetchThreads, fetchContactDeliverables,
  refreshContact, sayToContactStream, draftToGmail,
} from '../lib/people.js'
import { useLiveReply } from '../lib/useLiveReply.js'
import Veil from './Veil.jsx'
import { useVeiled } from '../lib/veil.js'

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

export default function PersonFocus({
  person, onBack, onChanged, onOpenPursuit,
  // 两种装法：page 是桌上那格（整页三栏），drawer 是通讯录旁边划出来的抽屉
  // （三栏叠成一栏）。跟机会线同一套规矩——线和人两套规矩就得教。
  variant = 'page',
  // 抽屉头上那颗开关：这张在不在桌上（见 DeskToggle）。
  onDesk = false, onToggleDesk,
}) {
  const c = person
  const [msgs, setMsgs] = useState(null)
  const [threads, setThreads] = useState([])
  const [dels, setDels] = useState([])
  const [busy, setBusy] = useState(null)      // 'sync' | 'talk' | 'gmail' | null
  // 正在就地改的那一句。库里还什么都没动——见 Resay.jsx 顶上那段。
  const [editId, setEditId] = useState(null)
  // 它正在打的那段字（还没落库），跟机会线那边同一套
  const { live, act, onEvent: onLive, reset: resetLive } = useLiveReply()

  // 「记一笔」旁边那层说明：悬停一秒才出来。
  //
  // 一秒是故意的——手划过去不该弹东西，只有停下来看才算在问。
  // 收起来留 240ms 缓冲：从按钮挪到说明层上，中间那几像素的空隙不该把它关掉。
  // pinRef 是给下拉框用的：原生下拉展开时鼠标其实已经离开了这一层，
  // 不按住就会选到一半自己关掉。
  const [howto, setHowto] = useState(false)
  const howtoT = useRef(0)
  const pinRef = useRef(false)
  const howtoIn = () => {
    clearTimeout(howtoT.current)
    if (!howto) howtoT.current = setTimeout(() => setHowto(true), 1000)
  }
  const howtoOut = () => {
    clearTimeout(howtoT.current)
    howtoT.current = setTimeout(() => { if (!pinRef.current) setHowto(false) }, 240)
  }
  useEffect(() => () => clearTimeout(howtoT.current), [])
  const [text, setText] = useState('')
  const [touching, setTouching] = useState(false)   // 「刚聊过」展开了输入
  const [touchText, setTouchText] = useState('')
  const taRef = useRef(null)
  const [claim, setClaim] = useState('')
  const [onLine, setOnLine] = useState('')        // 这次接触也算在哪条线上
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
  // 换了个人，上一张名片上改到一半的那句跟着收掉
  useEffect(() => { setEditId(null) }, [c.id])

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
  // 往来 = 跟这个人真实来往过的每一次：邮件是一次，见面/通话/微信也是一次。
  const mails = (msgs || []).filter(isExchange)
  // 往来分两格。**这个区别 Fairwind 也要知道**：
  // 邮件是有凭据的（库里有原文），我记的是你的记忆（只有你那一句）。
  // 它给你写回信的时候，这两种材料的分量不一样。
  const emails = mails.filter(isLetter)
  const notes  = mails.filter((m) => m.role === 'note')
  const talk  = (msgs || []).filter((m) => !m.gmail_message_id && m.role !== 'note')

  // 「上次碰」光有日期是没用的。「8/10 · 你记的一笔」等于没说——
  // 你想知道的是**上次到底发生了啥**：哪封信说了什么、那次见面聊了什么。
  //
  // 所以把产生那个日期的那条记录找出来，把它那句话摆上去。
  // 对不上日子的（你按了「聊过了」但没写内容）就老实说没记内容，
  // 不拿一句「你记的一笔」糊弄过去。
  const touches = (msgs || []).filter(isExchange)
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

  // said 是「重说」交过来的那句改完的话。不传就是输入框里那句。
  // 跟机会线那边同一个道理：两条路共用一份，分开写迟早有一边吞掉你打的字。
  const say = async (said) => {
    const t = (said ?? text).trim()
    if (!t || busy) return
    setBusy('talk'); if (said == null) setText('')
    // run_id 不是给「终止」用的（这一栏没有终止按钮），是给「你把页面关了」用的：
    // 脑子那边靠它把没人等的那一次掐掉。
    const runId = crypto.randomUUID()
    // 你说的话立刻上屏，不等它想完。
    //
    // 这一栏原来是 await 完再 reload()，于是**你自己发的那句要等它想完才出现**
    // ——十几秒里屏幕上只有三个点，你连自己按没按下去都不知道。
    // 机会线那边一直是乐观插入的，这儿是漏了。
    const tmp = { id: 'tmp-' + Date.now(), role: 'artist', content: t, created_at: new Date().toISOString() }
    setMsgs((m) => [...(m || []), tmp])
    try {
      await sayToContactStream(c.id, t, runId, (e) => {
        // 落库了就把临时那条换成真的（带真 id、真时间），免得等下 reload 撞出两条
        if (e.t === 'mine') setMsgs((m) => (m || []).map((x) => (x.id === tmp.id ? e.row : x)))
        else onLive(e)
      })
      await reload()
    } catch (err) {
      // 脑子是先存你的话、再去想的，所以失败有两种：
      //   连不上 → 一个字都没存 → 把话还回输入框，别让你白打
      //   存了但想崩了 → 话已经在库里 → 不能还，还了你再发一次就重了
      const rows = await fetchContactMessages(c.id)
      const landed = rows?.some((m) => m.role === 'artist' && m.content === t)
      if (rows) setMsgs(rows)
      else setMsgs((m) => (m || []).filter((x) => x.id !== tmp.id))
      if (!landed) setText((cur) => cur || t)   // 期间你要是又打了别的，就别覆盖
      alert(err.message + (landed
        ? '（你的话存下了，Fairwind 没想完 —— 再说一次让它重想）'
        : '（你的话还在框里，没丢）'))
    } finally { setBusy(null); resetLive() }
  }

  /**
   * 重说：撤掉这句和它之后的对话，再把改完的这句发出去。跟机会线那边一套规矩。
   *
   * 顺序不能反 —— 先撤再发，Fairwind 拿到的才是干净的往来。
   */
  const resay = async (id, said) => {
    const t = said.trim()
    if (!t || busy) return
    try {
      await rewindChat(id)
    } catch (e) {
      // 停在编辑态：你改的字还在框里，可以再按一次
      alert('没撤成：' + e.message + '（你改的字还在，可以再按一次重说）')
      return
    }
    setEditId(null)
    setMsgs((cur) => dropFrom(cur || [], id))
    await say(t)
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
    try { await logMeet(c.id, t.trim(), onLine || null); await reload(); onChanged?.(); after?.() }
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
      // 这条是**退路**，不是主路：要加附件（作品集 PDF）的信走它。
      // 主路是右栏那颗「发送」，那颗直接发，发完当场记进左栏往来。
      alert(`放进草稿箱了${out.to ? `（收信人 ${out.to}）` : ''}。去 Gmail 里挂上附件再按发送。`)
    } catch (e) { alert(e.message) } finally { setBusy(null) }
  }

  // 真发。两段确认：armed 是「上膛」，再按一下才出去。
  const [armed, setArmed] = useState(null)
  const doSend = async (id) => {
    if (busy) return
    setBusy('send')
    try {
      await sendLetterNow({ contactId: c.id }, id)
      setArmed(null)
      await reload()
      onChanged?.()
    } catch (e) {
      setArmed(null)
      // 授权掉了要说人话，别让你对着一句 HTTP 401 猜
      alert(e.needsAuth && e.fix ? `${e.message}\n\n${e.fix}` : e.message)
    } finally { setBusy(null) }
  }

  const channels = (Array.isArray(c.channels) && c.channels.length)
    ? c.channels : (c.email ? [{ kind: 'email', value: c.email }] : [])

  // 展示模式下 title 属性也不许挂名字——悬停一下气泡里就露了。
  const veiled = useVeiled()

  return (
    <div className={'focus ' + variant}>
      {/* 必须包在 .focus-top 里：三栏的高度是 .focus 这个 flex 列分下来的，
          头部漏了这层，.focus-cols 就拿不到 flex:1，整个版面塌成一坨。 */}
      <div className="focus-top">
        <div className="ft-head">
          {variant === 'drawer' ? (
            <button className="back" onClick={onBack} aria-label="收起" title="收起"><span aria-hidden="true">✕</span><span className="t"> 收起</span></button>
          ) : (
            <button className="back" onClick={onBack}><span aria-hidden="true">←</span><span className="t"> 通讯录</span></button>
          )}
          <h1 className="ft-title" title={veiled ? undefined : c.name}><Veil>{c.name || '未具名联系人'}</Veil></h1>
          {variant === 'drawer' && <DeskToggle on={onDesk} onToggle={onToggleDesk} />}
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
                <Veil>{o.org}</Veil>{o.role ? <span className="pf-note"> · {o.role}</span> : null}
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
                <span className="pf-mail"><Veil>{e.email}</Veil></span>
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
                    <span key={i} className="pchip" title={veiled ? undefined : x.value}>{CH[x.kind] || x.kind}</span>))
                : <span className="pf-empty">只有邮箱</span>}
            </div>
          </div>

          {/* Warm intro 的闭环：过阵子单独回介绍人一句。大多数人不做这一步。 */}
          {c.intro_by && (
            <div className="pf-cell">
              <div className="pf-k">谁介绍的</div>
              <div className="pf-v">
                <Veil>{c.intro_by_name || '（库里那个人）'}</Veil>
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

          {/* 由头原来贴在这儿。挪去顶栏那个 🔔 了 —— 同一件事不该有两个位置。
              名片上留的是**这个人是谁**，该动哪个由通知栏一处说。
              见 docs/specs/2026-08-18-notifications-design.md */}

          {/* ── 往来：跟这个人真实来往过的每一次 ──
              分两格是因为两种材料分量不一样：邮件有凭据（库里存着原文），
              我记的只有你那一句。Fairwind 写回信时要分得清。 */}
          <div className="pf-sect">
            <div className="pf-sect-h">
              <span>往来</span>
              <button className="lnk" onClick={doSync} disabled={busy === 'sync'}
                      title="去 Gmail 拉这个人所有地址下的往来">
                {busy === 'sync' ? '收信中…' : '收信'}
              </button>
            </div>
            {note && <div className={'pf-syncnote' + (note.startsWith('收信失败') ? ' bad' : '')}>{note}</div>}

            {msgs === null ? <p className="pf-note">读着…</p> : (
              <>
                <Pool title="邮件" count={`${emails.length} 封`} defaultOpen={emails.length > 0}>
                  {emails.length
                    ? <MailList items={emails} head={3} />
                    : <p className="empty">还没有邮件往来。上面「收信」去他的地址下找一遍。</p>}
                </Pool>

                <Pool title="我记的" count={`${notes.length} 条`} defaultOpen={notes.length > 0}>
                  {notes.length
                    ? <MailList items={notes} head={3} />
                    : <p className="empty">当面聊了、通了电话、微信说了——在中栏记一条，它会长在这儿。</p>}
                </Pool>

                <div className="pf-field">
                  <input placeholder="贴 Gmail thread id" value={claim}
                         onChange={(e) => setClaim(e.target.value)} />
                  <button className="lnk" disabled={!claim.trim()}
                          onClick={async () => {
                            try { await claimThread(c.id, claim.trim()); setClaim(''); await reload() }
                            catch (e) { alert('没认上：' + e.message) }
                          }}>认领</button>
                </div>
                <div className="pf-note">认领了 {threads.length} 条 thread</div>
              </>
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
                      {/* 你自己说的那句能改了重说。它的回复、你记的一笔都不能——
                          前者是它说的话，后者是你记下的事实。 */}
                      {mine ? (
                        <SayBubble
                          m={m} msgs={msgs || []} editing={editId === m.id}
                          disabled={busy === 'talk'}
                          onStart={setEditId}
                          onCancel={() => setEditId(null)}
                          onResay={resay}
                        />
                      ) : (
                        <div className="bubble md"><Md>{m.content}</Md></div>
                      )}
                      {/* 它写的是一封信。在这之前这一栏的信只能靠你选中、复制、
                          切去 Gmail 粘贴——右栏那句「它写的草稿会出现在这儿」
                          从来没兑现过，因为模型根本没有建产出的口。 */}
                      {m.meta?.letter && (
                        <LetterCard
                          letter={m.meta.letter}
                          owner={{ contactId: c.id }} onAdopted={reload}
                        />
                      )}
                      {m.meta?.form && (
                        <FormCard
                          form={m.meta.form}
                          owner={{ contactId: c.id }} onAdopted={reload}
                        />
                      )}
                    </div>
                  )
                })
              ) : (
                <p className="pf-note">还没跟 Fairwind 商量过什么。下面说一句。（跟他本人的来往在左栏）</p>
              )}

              {/* 出字了就渲染成气泡（一行一行看着它想），还没出字才是三个点。
                  跟机会线那边同一套判断。 */}
              {busy === 'talk' && (
                <div className="msg producer">
                  <span className="who">Fairwind</span>
                  {live ? (
                    <div className="bubble md streaming"><Md>{live}</Md></div>
                  ) : (
                    <div className="bubble thinking"><i /><i /><i /></div>
                  )}
                  {act && !live && <span className="thinking-act">{act}</span>}
                </div>
              )}

            </div>
          </div>

          {/* 输入框和「记一笔」是一组，一起浮在底部。
              「记一笔」处置的是**输入框里那句话**，不是对话里的某条——所以它得跟着
              输入框走。原来它挂在时间线末尾，于是你打完字要抬头去够一个滚走了的按钮。 */}
          <div className="composer-dock">
            {/* 输入框跟机会线那个一模一样：一行装不下自己长高、Enter 发送
                Shift+Enter 换行。isComposing 那句不能删——中文输入法选词也敲
                Enter，不挡的话你选个词就把半句话发出去了。 */}
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
                {/* 必须包一层箭头函数：onClick={say} 会把鼠标事件当第一个参数塞进去，
                    而 say 的第一个参数现在是「重说」交过来的那句话。 */}
                <button className="send" aria-label="发送" onClick={() => say()}
                        disabled={busy === 'talk' || !text.trim()}>
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <path d="M8 13V3M8 3 4.5 6.5M8 3l3.5 3.5" stroke="#fff" strokeWidth="1.6"
                          strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
            </div>

            {/* 回车 = 跟 Fairwind 商量；这一行 = 把同一句话记成一次真实来往。
                同一个框两个去处，这个区别值得说清楚——但只值得说一次，所以原委
                收进悬停一秒才出来的那层，平时这儿只有三个字。

                下拉框跟着进悬浮层，没有删掉：它是**控件**不是说明。这次聊的常常
                就是某条线的事，挂上去那条线的卷宗里也看得见（同时挂两边，不是搬
                过去）。不让 AI 猜是哪条：他可能挂着三条，猜错了那段记忆就长在错
                的项目上，而项目卡是你写申请时照着看的。 */}
            <div className="jot-row"
                 onMouseEnter={howtoIn} onMouseLeave={howtoOut}
                 onFocusCapture={() => setHowto(true)}>
              {/* 点完就把说明收掉：点击会让按钮拿到焦点，不收的话你刚记完
                  它反而弹出来解释「记一笔是什么」——你显然已经知道了。 */}
              <button className="lnk jot-go"
                      onClick={() => { clearTimeout(howtoT.current); setHowto(false); jot() }}
                      disabled={busy === 'talk' || !text.trim()}>记一笔</button>
              {howto && (
                <div className="jot-howto" role="tooltip"
                     onMouseEnter={howtoIn} onMouseLeave={howtoOut}>
                  <p>回车 = 跟 <b>Fairwind</b> 商量（这一栏只装商量，不算往来）。</p>
                  <p>
                    线下见了面、通了电话、微信聊了？写一句按 <b>记一笔</b>——
                    它跟邮件一样是一次真实来往，进<b>左栏的往来</b>，并把「上次碰」记成今天。
                  </p>
                  {c.pursuits?.length > 0 && (
                    <p className="jot-online">
                      也算在
                      <select className="pf-online" value={onLine}
                              onMouseDown={() => { pinRef.current = true }}
                              onBlur={() => { pinRef.current = false }}
                              onChange={(e) => setOnLine(e.target.value)}>
                        <option value="">（不挂线）</option>
                        {c.pursuits.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                      </select>
                      上
                    </p>
                  )}
                  <p>他在找什么、答应过什么这类<b>认识</b>，写进左栏的<b>关系记忆</b>——那儿是累积的。</p>
                  {/* 按钮灰着却不说为什么，是最招人烦的一种沉默 */}
                  {!text.trim() && <p className="jot-need">现在灰着，是因为下面还没写字。</p>}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── 右 · 要发的信 ───────────────────────────────────── */}
        <aside className="fc-r">
          <div className="pf-sect-h"><span>要发的信</span></div>
          {dels.length === 0 ? (
            <p className="pf-note">
              还没有要发的信。在中栏跟 Fairwind 说「帮我回他」——它写完会在那条回复下面
              摆一张信卡，点「收进产出」，信就落到这儿，改完在这儿发。
            </p>
          ) : dels.map((d) => (
            <div key={d.id} className="pf-del">
              <div className="pf-who">
                {d.title}
                <span className="pf-tag">{d.status === 'final' ? '已定稿' : '草稿'}</span>
              </div>
              <div className="pf-body">{d.body}</div>
              {/* 发送键在你手上：这个口**不在模型的工具白名单里**，
                  只有这颗按钮能触发它。它写得出信，按不了发送键。
                  收件人明摆在按钮上——发错人是这条路上唯一撤不回来的错。 */}
              <button className="lnk send"
                      disabled={busy || !d.body?.trim() || !d.meta?.to}
                      onClick={() => (armed === d.id ? doSend(d.id) : setArmed(d.id))}
                      onBlur={() => setArmed(null)}>
                {busy === 'send' ? '正在发……'
                  : armed === d.id ? `确认发给 ${d.meta.to}`
                  : d.meta?.to ? `发送 → ${d.meta.to}` : '发送（没有收件人）'}
              </button>
              {armed === d.id
                ? <div className="pf-note warn">按下去信就出去了，撤不回来。</div>
                : d.meta?.to && <div className="pf-note">发出后当场记进左栏往来，这份就不在这儿了。</div>}
              {/* 退路：要加附件的信走这条 */}
              <button className="lnk" disabled={busy || !d.body?.trim()}
                      onClick={() => toGmail(d.id)}
                      title="要加附件的信走这条：放进草稿箱，去 Gmail 挂上附件再发">
                {busy === 'gmail' ? '正在放……'
                  : d.meta?.gmail_draft_id ? '再放一次草稿箱' : '放进草稿箱（要加附件时）'}
              </button>
            </div>
          ))}
        </aside>

      </div>
    </div>
  )
}
