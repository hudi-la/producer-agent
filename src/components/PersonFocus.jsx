import MailNotice from './MailNotice.jsx'
import { messageLetters } from '../lib/messageLetters.js'
import { reportError } from '../lib/reportError.js'
import ArtifactEditor from './ArtifactEditor.jsx'
import ArtifactCard from './ArtifactCard.jsx'
import { md, day } from '../lib/when.js'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { fetchContactMessages, rewindChat } from '../lib/chat.js'
import { dropFrom } from '../lib/rewind.js'
import Md from './Md.jsx'
import SayBubble from './Resay.jsx'
import Pool from './Pool.jsx'
import DeskToggle from './DeskToggle.jsx'
import { useGrow } from '../lib/useGrow.js'
import { MailList } from './Mail.jsx'
import { useModules } from '../lib/ModulesContext.jsx'
import { isLetter, isExchange, isContactTalk, arrivalMail } from '../lib/letter.js'
// 它写完一封信，对话里那条就渲染成一张信卡——点一下落进右栏「要发的信」。
import LetterCard from './LetterCard.jsx'
// 它填的是一张申请表——同一个路子，收进产出之后一格一格改。
import FormCard from './FormCard.jsx'
import StateMoveCard from './StateMoveCard.jsx'
import MemoCard from './MemoCard.jsx'
import { sendLetterNow } from '../lib/letters.js'
import {
  upsertContact, claimThread, logMeet, checkin, markIntroThanked,
  fetchThreads, fetchContactDeliverables,
  refreshContact, sayToContactStream, draftToGmail, logNote } from '../lib/people.js'
import { useLiveReply } from '../lib/useLiveReply.js'
import Veil from './Veil.jsx'
import { useVeiled } from '../lib/veil.js'
import { t } from '../i18n/index.js'

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

// 函数而不是常量：t() 得在渲染时调，模块加载时语言还没定。
const SRC = () => ({ email: t('来自那封信'), checkin: t('你打的卡'), meet: t('你记的一笔') })
const CH  = () => ({ email: t('邮箱'), wechat: t('微信'), sms: t('短信'), whatsapp: 'WhatsApp', ig: 'IG', phone: t('电话') })

/** 名片上一格：点一下能改，回车存。只发改动那一格（RPC 里 null 的字段一概不动）。 */
function Cell({ label, value, placeholder, onSave, type = 'text', multiline = false }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value ?? '')
  useEffect(() => { setV(value ?? '') }, [value])
  const save = async () => {
    setEditing(false)
    if ((v ?? '') === (value ?? '')) return
    try { await onSave(v) } catch (e) { reportError(t('没存上：') + e.message) }
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
  // 脑子开没开（App 每轮问 /health）。没开 = 输入框直接记笔，不聊天（0125）。
  brainUp = true,
}) {
  const c = person
  const [msgs, setMsgs] = useState(null)
  const [threads, setThreads] = useState([])
  const [dels, setDels] = useState([])
  const mods = useModules()
  const [artifactId, setArtifactId] = useState(null)
  useEffect(() => setArtifactId(null), [c.id])
  const selectedArtifact = dels.find(d => d.id === artifactId)
  const [busy, setBusy] = useState(null)      // 'sync' | 'talk' | 'gmail' | null
  // 正在就地改的那一句。库里还什么都没动——见 Resay.jsx 顶上那段。
  const [editId, setEditId] = useState(null)
  // 它正在打的那段字（还没落库），跟机会线那边同一套
  const { live, act, onEvent: onLive, reset: resetLive } = useLiveReply()

  const [text, setText] = useState('')
  const [touching, setTouching] = useState(false)   // 「刚聊过」展开了输入
  const [touchText, setTouchText] = useState('')
  const taRef = useRef(null)
  // 输入框按内容长高（往上长）。跟机会线那边同一份 —— 见 lib/useGrow.js。
  // 这一段原来整个漏了：名片这边的框永远一行高，多打两行就得在框里滚。
  useGrow(taRef, text)
  const [claim, setClaim] = useState('')
  const [onLine, setOnLine] = useState('')        // 这次接触也算在哪条线上
  const [note, setNote] = useState(null)      // 收信结果那句实话

  const reload = useCallback(async () => {
    const [m, th, d] = await Promise.all([
      fetchContactMessages(c.id), fetchThreads(c.id), fetchContactDeliverables(c.id),
    ])
    setMsgs(m || [])
    setThreads(th)
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
  const talk  = (msgs || []).filter(isContactTalk)

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
        ? t('收到 {n} 封新信', { n: out.added }) + (out.anchored ? t('；他说的日子记下了（{date}）', { date: out.next_touch_at }) : '')
        : t('查过了，没有新信')))
    } catch (e) { setNote(t('收信失败：') + e.message) } finally { setBusy(null) }
  }

  // said 是「重说」交过来的那句改完的话。不传就是输入框里那句。
  // 跟机会线那边同一个道理：两条路共用一份，分开写迟早有一边吞掉你打的字。
  const say = async (said) => {
    const line = (said ?? text).trim()
    if (!line || busy) return
    // 脑子没开：这句直接记成一笔（不是聊天），脑子醒了由盲格子判（0125）
    if (!brainUp) {
      setBusy('talk'); if (said == null) setText('')
      try { await logNote(c.id, line); await reload(); onChanged?.() }
      catch (err) { reportError(t('没记上：') + err.message); if (said == null) setText((cur) => cur || line) }
      finally { setBusy(null) }
      return
    }
    setBusy('talk'); if (said == null) setText('')
    // run_id 不是给「终止」用的（这一栏没有终止按钮），是给「你把页面关了」用的：
    // 脑子那边靠它把没人等的那一次掐掉。
    const runId = crypto.randomUUID()
    // 你说的话立刻上屏，不等它想完。
    //
    // 这一栏原来是 await 完再 reload()，于是**你自己发的那句要等它想完才出现**
    // ——十几秒里屏幕上只有三个点，你连自己按没按下去都不知道。
    // 机会线那边一直是乐观插入的，这儿是漏了。
    const tmp = { id: 'tmp-' + Date.now(), role: 'artist', content: line, created_at: new Date().toISOString() }
    setMsgs((m) => [...(m || []), tmp])
    try {
      await sayToContactStream(c.id, line, runId, (e) => {
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
      const landed = rows?.some((m) => m.role === 'artist' && m.content === line)
      if (rows) setMsgs(rows)
      else setMsgs((m) => (m || []).filter((x) => x.id !== tmp.id))
      if (!landed) setText((cur) => cur || line)   // 期间你要是又打了别的，就别覆盖
      reportError(err.message + (landed
        ? t('（你的话存下了，Fairwind 没想完 —— 再说一次让它重想）')
        : t('（你的话还在框里，没丢）')))
    } finally { setBusy(null); resetLive() }
  }

  /**
   * 重说：撤掉这句和它之后的对话，再把改完的这句发出去。跟机会线那边一套规矩。
   *
   * 顺序不能反 —— 先撤再发，Fairwind 拿到的才是干净的往来。
   */
  const resay = async (id, said) => {
    const line = said.trim()
    if (!line || busy) return
    try {
      await rewindChat(id)
    } catch (e) {
      // 停在编辑态：你改的字还在框里，可以再按一次
      reportError(t('没撤成：') + e.message + t('（你改的字还在，可以再按一次重说）'))
      return
    }
    setEditId(null)
    setMsgs((cur) => dropFrom(cur || [], id))
    await say(line)
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
  const logTouch = async (line, after) => {
    if (!line.trim() || busy) return
    setBusy('talk')
    try { await logMeet(c.id, line.trim(), onLine || null); await reload(); onChanged?.(); after?.() }
    catch (e) { reportError(t('没记上：') + e.message) } finally { setBusy(null) }
  }

  // 「刚聊过」：**一定顺手写一句**。空打卡只留一个日期，
  // 而一个说不出内容的日期正是「上次碰」原来那么难用的原因。
  const doTouch = async () => {
    const line = touchText.trim()
    if (line) await logTouch(line, () => { setTouchText(''); setTouching(false) })
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
      alert(t('放进草稿箱了{to}。去 Gmail 里挂上附件再按发送。', { to: out.to ? t('（收信人 {to}）', { to: out.to }) : '' }))
    } catch (e) { reportError(e) } finally { setBusy(null) }
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
      reportError(e.needsAuth && e.fix ? `${e.message}\n\n${e.fix}` : e.message)
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
            <button className="back" onClick={onBack} aria-label={t('收起')} title={t('收起')}><span aria-hidden="true">✕</span><span className="t"> {t('收起')}</span></button>
          ) : (
            <button className="back" onClick={onBack}><span aria-hidden="true">←</span><span className="t"> {t('通讯录')}</span></button>
          )}
          <h1 className="ft-title" title={veiled ? undefined : c.name}><Veil>{c.name || t('未具名联系人')}</Veil></h1>
          {variant === 'drawer' && <DeskToggle on={onDesk} onToggle={onToggleDesk} />}
        </div>
      </div>

      <div className={"focus-cols" + (selectedArtifact ? "" : " without-editor")}>

        {/* ── 左 · 卷宗：他是谁 + 往来 ─────────────────────────── */}
        <aside className="fc-l">
          {/* 机构：一个人可以待过好几个。**离开了的不删**，标上到哪天为止——
              「她以前在 CultureHub」是真事，而且正是它解释了为什么
              stacy@culturehub.org 那几封信是她的。 */}
          <div className="pf-cell">
            <div className="pf-k">{t('机构')}</div>
            {(c.orgs?.length ? c.orgs : [null]).map((o, i) => o ? (
              <div key={i} className={'pf-v pf-hist' + (o.until ? ' past' : '')}>
                <Veil>{o.org}</Veil>{o.role ? <span className="pf-note"> · {o.role}</span> : null}
                {o.until && <span className="pf-past-tag">{t('到 {date} 为止', { date: o.until })}</span>}
                {!o.until && o.since && <span className="pf-note"> · {t('{date} 起', { date: o.since })}</span>}
              </div>
            ) : <div key={i} className="pf-empty">{t('没填')}</div>)}
          </div>

          {/* 邮箱：一个人会换。**停用的留着**——旧地址是历史往来的钥匙，
              删了那些信就再也认不回来。 */}
          <div className="pf-cell">
            <div className="pf-k">{t('邮箱')}</div>
            {(c.emails?.length ? c.emails : [null]).map((e, i) => e ? (
              <div key={i} className={'pf-v pf-hist' + (e.until ? ' past' : '')}>
                <span className="pf-mail"><Veil>{e.email}</Veil></span>
                {e.is_primary && !e.until && <span className="pf-now-tag">{t('在用')}</span>}
                {e.until && <span className="pf-past-tag">⛔ {t('{date} 起停用', { date: e.until })}</span>}
                {e.note && <div className="pf-note">{e.note}</div>}
              </div>
            ) : <div key={i} className="pf-empty">{t('没填')}</div>)}
          </div>

          <div className="pf-cell">
            <div className="pf-k">{t('别的渠道')}</div>
            <div className="pf-chips">
              {channels.length
                ? channels.map((x, i) => (
                    <span key={i} className="pchip" title={veiled ? undefined : x.value}>{CH()[x.kind] || x.kind}</span>))
                : <span className="pf-empty">{t('只有邮箱')}</span>}
            </div>
          </div>

          {/* Warm intro 的闭环：过阵子单独回介绍人一句。大多数人不做这一步。 */}
          {c.intro_by && (
            <div className="pf-cell">
              <div className="pf-k">{t('谁介绍的')}</div>
              <div className="pf-v">
                <Veil>{c.intro_by_name || t('（库里那个人）')}</Veil>
                {c.intro_thanked_at
                  ? <span className="pf-note"> · {t('{date} 回谢过了', { date: md(c.intro_thanked_at) })}</span>
                  : <button className="lnk pf-inline"
                            onClick={async () => { await markIntroThanked(c.id); onChanged?.() }}>
                      {t('回谢了')}
                    </button>}
              </div>
            </div>
          )}

          {/* 日期永远说得出出处。没有来源的日期是来路不明的数字。 */}
          {/* 上次碰：日期 + 渠道 + **那一次说了什么**。
              只有日期的话（「8/10 · 你记的一笔」）等于没说，你还得自己去翻。 */}
          <div className="pf-cell">
            <div className="pf-k">{t('上次碰')}</div>
            {c.last_touch_at ? (
              <>
                <div className="pf-v">
                  {md(c.last_touch_at)}
                  <span className="pf-note"> · {SRC()[c.last_touch_src] || t('来源不明')}</span>
                </div>
                {touchShown
                  ? <div className="pf-touch">{touchShown.content}</div>
                  : <div className="pf-touch none">{t('这次没记内容——只按了「聊过了」')}</div>}
              </>
            ) : <div className="pf-empty">{t('还没碰过')}</div>}

            {/* 微信 / 电话 / 线下系统看不见，靠你这一下。但**一定顺手写一句**：
                空打卡只留个日期，而说不出内容的日期正是上面那行原来那么难用的原因。 */}
            {touching ? (
              <div className="pf-field">
                <input autoFocus value={touchText} placeholder={t('刚才聊了什么？一句话')}
                       onChange={(e) => setTouchText(e.target.value)}
                       onKeyDown={(e) => {
                         if (e.key === 'Escape') { setTouchText(''); setTouching(false) }
                         if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); doTouch() }
                       }} />
                <button className="lnk" onClick={doTouch} disabled={busy === 'talk'}>{t('记下')}</button>
              </div>
            ) : (
              <button className="lnk pf-inline" onClick={() => setTouching(true)}>{t('刚聊过')}</button>
            )}
          </div>

          <Cell label={t('下次碰')} value={c.next_touch_at} placeholder={t('没定')} type="date"
                onSave={(v) => save({ next_touch_at: v || null,
                                      next_touch_why: v ? t('你自己定的') : null })} />
          {c.next_touch_why && <div className="pf-note pf-why">{c.next_touch_why}</div>}

          <Cell label={t('关系记忆')} multiline value={c.notes}
                placeholder={t('他关心什么、答应过什么、上回聊了什么')}
                onSave={(v) => save({ notes: v })} />

          {/* 由头原来贴在这儿。挪去顶栏那个 🔔 了 —— 同一件事不该有两个位置。
              名片上留的是**这个人是谁**，该动哪个由通知栏一处说。
              见 docs/specs/2026-08-18-notifications-design.md */}

          {/* ── 往来：跟这个人真实来往过的每一次 ──
              分两格是因为两种材料分量不一样：邮件有凭据（库里存着原文），
              我记的只有你那一句。Fairwind 写回信时要分得清。 */}
          <div className="pf-sect">
            <div className="pf-sect-h">
              <span>{t('往来')}</span>
              {mods.mail && <button className="lnk" onClick={doSync} disabled={busy === 'sync'}
                      title={t('去 Gmail 拉这个人所有地址下的往来')}>
                {busy === 'sync' ? t('收信中…') : t('收信')}
              </button>}
            </div>
            {note && <div className={'pf-syncnote' + (note.startsWith(t('收信失败：')) ? ' bad' : '')}>{note}</div>}

            {msgs === null ? <p className="pf-note">{t('读着…')}</p> : (
              <>
                <Pool title={t('邮件')} count={t('{n} 封', { n: emails.length })} defaultOpen={emails.length > 0}>
                  {emails.length
                    ? <MailList items={emails} head={3} />
                    : <p className="empty">{t('还没有邮件往来。上面「收信」去他的地址下找一遍。')}</p>}
                </Pool>

                <Pool title={t('我记的')} count={t('{n} 条', { n: notes.length })} defaultOpen={notes.length > 0}>
                  {notes.length
                    ? <MailList items={notes} head={3} />
                    : <p className="empty">{t('当面聊了、通了电话、微信说了——在中栏记一条，它会长在这儿。')}</p>}
                </Pool>

                {mods.mail && <div className="pf-field">
                  <input placeholder={t('贴 Gmail thread id')} value={claim}
                         onChange={(e) => setClaim(e.target.value)} />
                  <button className="lnk" disabled={!claim.trim()}
                          onClick={async () => {
                            try { await claimThread(c.id, claim.trim()); setClaim(''); await reload() }
                            catch (e) { reportError(t('没认上：') + e.message) }
                          }}>{t('认领')}</button>
                </div>}
                <div className="pf-note">{t('认领了 {n} 条 thread', { n: threads.length })}</div>
              </>
            )}
          </div>
        </aside>

        {/* ── 中 · 跟 Fairwind 商量 ─────────────────────────────
            对话自己滚（.focus-scroll），顶栏和左右两栏不跟着走——
            跟机会线详情页一个结构。以前没这层，聊长了整页一起滚，
            左边那张名片和右边的草稿全被推出视野。 */}
        <section className="fc-m">
          {dels.filter(d => !d.meta?.artifact_message_id && d.status === 'draft').map(d =>
            <ArtifactCard key={d.id} existing={d} editorOpen={!!selectedArtifact} owner={{ contactId: c.id }}
              onAdopted={async id => { await reload(); if (id) setArtifactId(id) }} />)}
          <div className="focus-scroll">
            <div className="focus-inner">
              {/* 「人是独立一层、两区共用同一张名片」看得见的样子 */}
              {c.pursuits?.length > 0 && (
                <div className="pf-lines">
                  <span className="pf-k">{t('他挂着的机会线')}</span>
                  {c.pursuits.map((p) => (
                    <button key={p.id} className="lnk" onClick={() => onOpenPursuit?.(p.id)}>{p.title}</button>
                  ))}
                </div>
              )}

              {talk.length ? (
                talk.map((m) => {
                  if (m.kind === 'arrival') return <MailNotice key={m.id} m={arrivalMail(m, msgs)} />
                  // 谁在说话得说准，跟机会线那边一个判据。
                  const mine = m.role === 'artist'
                  const isNote = m.role === 'note'
                  return (
                    <div key={m.id} className={'msg' + (mine ? ' you' : isNote ? ' note' : ' producer')}>
                      <span className="who">
                        {isNote ? (m.kind === 'memo' ? t('记住的一句') : t('你记的一次接触')) : mine ? t('你') : 'Fairwind'}
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
                        <div className="bubble md"><Md>{messageLetters(m).clean}</Md></div>
                      )}
                      {/* 它写的是一封信。在这之前这一栏的信只能靠你选中、复制、
                          切去 Gmail 粘贴——右栏那句「它写的草稿会出现在这儿」
                          从来没兑现过，因为模型根本没有建产出的口。 */}
                      {messageLetters(m).letters.map(({ letter, index }) => (
                        <LetterCard
                          key={index} letter={letter} artifactIndex={index}
                          owner={{ contactId: c.id }} messageId={m.id} items={dels} editorOpen={!!selectedArtifact} onAdopted={async id => { await reload(); if (id) setArtifactId(id) }}
                        />
                      ))}
                      {m.meta?.form && (
                        <FormCard
                          form={m.meta.form}
                          owner={{ contactId: c.id }} messageId={m.id} items={dels} editorOpen={!!selectedArtifact} onAdopted={async id => { await reload(); if (id) setArtifactId(id) }}
                        />
                      )}
                      {m.meta?.state_move?.applied && (
                        <StateMoveCard msgId={m.id} move={m.meta.state_move} onUndone={reload} />
                      )}
                      {m.meta?.memo?.applied && (
                        <MemoCard msgId={m.id} memo={m.meta.memo} onUndone={async () => { await reload(); onChanged?.() }} />
                      )}
                    </div>
                  )
                })
              ) : (
                <p className="pf-note">{t('还没跟 Fairwind 商量过什么。下面说一句。（跟他本人的来往在左栏）')}</p>
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

          {/* 一个框两种落法（0125）：脑子醒着 = 聊天，Fairwind 顺便判该记成什么；
              脑子没开 = 直接记成一笔。「记一笔」按钮退场了。 */}
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
                  ? t('Fairwind 在想……（想完会自动出现，你不用守着）')
                  : !brainUp ? t('脑子没开：这句会直接记成一笔，不是聊天')
                  : t('一起想点什么…… Fairwind 带着这个人的全部往来，你不用重讲')}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
                  e.preventDefault()
                  say()
                }}
              />
                {/* 必须包一层箭头函数：onClick={say} 会把鼠标事件当第一个参数塞进去，
                    而 say 的第一个参数现在是「重说」交过来的那句话。 */}
                <button className="send" aria-label={t('发送')} onClick={() => say()}
                        disabled={busy === 'talk' || !text.trim()}>
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <path d="M8 13V3M8 3 4.5 6.5M8 3l3.5 3.5" stroke="#fff" strokeWidth="1.6"
                          strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
            </div>

          </div>
        </section>

        {/* ── 右 · 要发的信 ───────────────────────────────────── */}
        {selectedArtifact && <ArtifactEditor key={selectedArtifact.id} d={selectedArtifact}
          onChanged={reload} onClose={() => setArtifactId(null)} />}


      </div>
    </div>
  )
}
