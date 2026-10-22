import ErrorNotice from './ErrorNotice.jsx'
import { reportError } from '../lib/reportError.js'
import React, { useRef, useState } from 'react'
import { useGrow } from '../lib/useGrow.js'
import {
  identifyEmail, claimEmail, markOrgMailbox, upsertContact, claimThread, refreshContact,
  attachAddressLines, carryMailbox,
} from '../lib/people.js'
import Veil from './Veil.jsx'
import { t } from '../i18n/index.js'
import { adopt, overrideVerdict } from '../lib/mail.js'
import { runAdopt, useBgTask } from '../lib/bgTask.js'

// 加人。
//
// 走过两版错的：
//   一、让你填表（名字、邮箱、机构一格格敲）—— 这些信里全都有，凭什么让你敲
//   二、让你从下拉框挑「这是谁」—— 几千个联系人的时候你挑不动
//
// 现在的形状：**Fairwind 去读那几封信，自己判断，摆一句填好的话给你，你点头。**
// 签名里有名字和网站，正文里有机构和头衔，主题行里常写着谁介绍的——
// 该干这活的是它。
//
// 但它**只提议，不写库**。认错人比不认更麻烦，所以最后那下永远是你按的。
// 这跟卡上那个「它提的 / 认了」是同一条规矩。

const md = (s) => {
  if (!s) return '—'
  const [, m, d] = String(s).split('-')
  return `${Number(m)}/${Number(d)}`
}

/**
 * 只留真有值的那些键。
 *
 * 认人的结果里「没查到」是 null，而手上的 prefill 里署名是确凿的。
 * 直接 {...pre, ...got} 会让一个 null 把信头上的名字抹掉 —— 那是拿
 * 「不知道」覆盖「知道」。
 */
const filled = (o) => Object.fromEntries(
  Object.entries(o || {}).filter(([, v]) => v !== null && v !== undefined && v !== ''))

/** Fairwind 认出来的那张草稿名片。你改得动，也可以整个否掉。 */
function Proposal({ who, email, contacts, onDone, onCancel }) {
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({
    name: who.name || '', org: who.org || '', role: who.role || '',
    notes: who.notes || '',
  })
  const notesRef = useRef(null)
  useGrow(notesRef, f.notes)
  // 它命中了通讯录里某位 → 默认走「合并」；否则默认建新人
  const matched = who.match_name
    ? contacts.find((c) => c.name === who.match_name)
    : null
  const [how, setHow] = useState(
    who.kind === 'shared_box' ? 'org' : matched ? 'merge' : 'new')

  const go = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (how === 'org') {
        await markOrgMailbox(email, f.org || who.org || '未具名机构', '共享信箱', who.notes || null)  // i18n-ok 跟后台 0121 写的同一个标签，是存进库的数据
        // 立刻搬它名下的信 —— 不等每小时的兜底（Stanford 那封确认信
        // 干等过一小时）。搬完线上的归属、转移表判断都在下一轮自然跟上。
        try { await carryMailbox(email) } catch (e) { reportError(e, t('后续整理未完成，请检查联系人和邮件归属。')) }
        // 人跟着信一起归位：这个信箱的信已经在哪条线上，就挂成那条线的
        // 相关方。真事：adavi290 的信早就在 ASU 线上，认领后却没人挂 —— 他手动的。
        try {
          const lines = await attachAddressLines(email, { mailbox: email })
          if (lines?.length) console.log('顺手挂到了：' + lines.join('、'))  // i18n-ok 只进开发者控制台
        } catch (e) { reportError(e, t('后续整理未完成，请检查联系人和邮件归属。')) }
      } else {
        let id = matched?.id
        if (how === 'new') {
          if (!f.name.trim()) throw new Error(t('要有名字'))
          const c = await upsertContact({
            name: f.name.trim(), email,
            org: f.org.trim() || null, role: f.role.trim() || null,
            notes: f.notes.trim() || null,
          })
          id = c.id
        }
        if (!id) throw new Error(t('没有可合并的人'))
        // 认领地址：这个地址名下所有历史往来当场归位
        await claimEmail(email, id, how === 'merge' ? t('Fairwind 从信里认出这是他的另一个邮箱') : null)
        // 人跟着信一起归位（同上共享信箱那条注释）
        try {
          const lines = await attachAddressLines(email, { contactId: id })
          if (lines?.length) console.log('顺手挂到了：' + lines.join('、'))  // i18n-ok 只进开发者控制台
        } catch (e) { reportError(e, t('后续整理未完成，请检查联系人和邮件归属。')) }
        // 顺手认领它读到的那几条 thread，以后按「收信」就跟着走
        for (const th of who.threads || []) {
          try { await claimThread(id, th) } catch (e) { reportError(e, t('后续整理未完成，请检查联系人和邮件归属。')) }
        }
        if (who.threads?.length) { try { await refreshContact(id) } catch (e) { reportError(e, t('后续整理未完成，请检查联系人和邮件归属。')) } }
      }
      onDone?.()
    } catch (e) {
      reportError(e, t('联系人整理失败'))
    } finally { setBusy(false) }
  }

  if (who.kind === 'unknown') {
    return (
      <div className="prop">
        <p className="pf-note">
          {who.note ? t('Fairwind 没认出来这是谁（{note}）。', { note: who.note }) : t('Fairwind 没认出来这是谁。')}
          {' '}{t('可能是信太少、也可能签名里什么都没写。你自己填一个吧。')}
        </p>
        <div className="stranger-btns">
          <button className="lnk" onClick={() => setHow('new')}>{t('我自己填')}</button>
          <button className="lnk" onClick={onCancel}>{t('算了')}</button>
        </div>
        {how === 'new' && (
          <div className="stranger-form">
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
                   placeholder={t('他叫什么')} autoFocus />
            <div className="stranger-btns">
              <button className="lnk" disabled={busy} onClick={go}>{t('加上')}</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="prop">
      <div className="prop-head">
        {who.kind === 'shared_box' ? (
          <span><b>{t('这是机构的共享信箱')}</b>{t('，不是某个人')}</span>
        ) : matched ? (
          <span>{t('这是')} <b><Veil>{who.match_name}</Veil></b>{t(' 的另一个邮箱')}</span>
        ) : (
          <span>{t('通讯录里没有，这是个新人')}</span>
        )}
        {who.confidence === 'low' && <span className="pchip">{t('它自己也不太确定')}</span>}
      </div>

      {who.match_why && <p className="pf-note">{t('依据：')}{who.match_why}</p>}

      {how !== 'org' && (
        <div className="prop-fields">
          <label>{t('名字')}<input value={f.name} disabled={how === 'merge'}
                            onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>{t('机构')}<input value={f.org}
                            onChange={(e) => setF({ ...f, org: e.target.value })} /></label>
          <label>{t('他管什么')}<input value={f.role}
                            onChange={(e) => setF({ ...f, role: e.target.value })} /></label>
        </div>
      )}
      {how === 'org' && (
        <div className="prop-fields">
          <label>{t('哪个机构')}<input value={f.org}
                            onChange={(e) => setF({ ...f, org: e.target.value })} /></label>
        </div>
      )}

      {/* 机构和头衔是哪儿来的。**不是要他去核对** —— 是这两格不再是他敲的，
          那就得说得出出处，跟卡上「它提的 / 认了」同一条规矩。 */}
      {who.found_by && how !== 'merge' && <p className="pf-note">{t('机构和头衔：')}<Veil>{who.found_by}</Veil></p>}
      {who.site && <p className="pf-note">{t('个人站')} <Veil>{who.site}</Veil></p>}
      {who.intro_by && <p className="pf-note">{t('谁介绍的：')}<Veil>{who.intro_by}</Veil></p>}
      {f.notes && how !== 'org' && (
        <label className="prop-notes">{t('关系记忆')}
          <textarea ref={notesRef} rows={4} value={f.notes}
                    onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </label>
      )}

      <div className="stranger-btns">
        <button className="lnk" disabled={busy} onClick={go}>
          {busy ? t('弄着…')
            : how === 'org' ? t('记成机构共享信箱')
            : how === 'merge' ? <>{t('合到')} <Veil>{who.match_name}</Veil>{t(' 名下')}</> : t('加进通讯录')}
        </button>
        {/* 它判断错了你得改得动。合并/新建/共享箱三条路随时切。 */}
        {how !== 'new' && <button className="lnk" onClick={() => setHow('new')}>{t('不对，是个新人')}</button>}
        {how !== 'merge' && matched &&
          <button className="lnk" onClick={() => setHow('merge')}>{t('其实是')} <Veil>{who.match_name}</Veil></button>}
        {how !== 'org' && <button className="lnk" onClick={() => setHow('org')}>{t('其实是共享信箱')}</button>}
        <button className="lnk" onClick={onCancel}>{t('算了')}</button>
      </div>
    </div>
  )
}

/** 一个地址：先让 Fairwind 去认，再摆提议。 */
function One({ email, meta, contacts, onDone, onCancel }) {
  const [who, setWho] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const pre = meta?.prefill || null

  // 去认一次。
  //
  // 被引荐、被抄送的人（0121/0125）以前不走这儿 —— 当时的理由是「它自己一封
  // 没发过，没信可读」，于是直接摆一张**机构和头衔全空**的表单。结果那两格
  // 就落到他头上：2026-09-11「你这个机构和职位都非得要我填吗？你自己去网上
  // 查一查不行吗？」他说得对。这个文件开头写着「这些信里全都有，凭什么让你敲」，
  // 空着两格递过去，是同一个错的第三版。
  //
  // 现在同一条路：带他进来的那封信在 `to:他` 里搜得到（引荐信的正文往往
  // 就是他是谁的最好说明），信里没有的机构和头衔，那边会上网查。
  // 署名和来路这边是确凿的，一并递过去当线索，认完再拿它兜底 —— 查不到
  // 也至少不比以前少。
  const ask = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const got = await identifyEmail(email, { hint: meta?.why || null, name: pre?.name || meta?.信头署名 || null })
      // 空值不许覆盖已有的：它查不到机构，不等于要把信头上的署名也抹掉。
      setWho({ ...(pre || {}), ...filled(got) })
    } catch (e) {
      // 认不成也别把他卡在这儿：手上本来就有署名和来路，摆出来让他点头，
      // 跟改之前一样 —— 只是多试了一次。
      if (pre) { setWho(pre); setErr(e.message + t('（网上没查着，先按信头上的来）')) }
      else setErr(e.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="stranger">
      <div className="stranger-h">
        <span className="prow-n"><Veil>{meta?.信头署名 || email}</Veil></span>
        {meta?.信头署名 && <span className="pf-note"><Veil>{email}</Veil></span>}
        <span className="prow-sp" />
        {meta && !meta.prefill && <>
          <span className="pchip">{t('{n} 封', { n: meta.封数 })}</span>
          <span className="pf-note">
            {t('他发来 {a} · 你发去 {b}', { a: meta.他发来的, b: meta.你发去的 })} · {md(meta.第一次)}–{md(meta.最近一次)}
          </span>
        </>}
        {/* 这是整块唯一的操作口，得长得像个按钮 —— 文字链他真的没认出来
            （2026-08-20：「没有可以操作的地方啊」）。
            被引荐、被抄送的人也走这儿：他们的机构和头衔要上网查，
            不能空着两格递给他自己敲（2026-09-11）。 */}
        {!who && <button className="nopen" onClick={ask} disabled={busy}>
          {busy ? (pre ? t('读信、上网查…') : t('读信中…')) : t('这是谁？')}
        </button>}
      </div>

      {meta?.why && <div className="pf-note"><Veil>{meta.why}</Veil></div>}
      {meta?.出现在哪些机会线?.length > 0 && (
        <div className="pf-note">{t('出现在：')}{meta.出现在哪些机会线.join(' · ')}</div>
      )}
      {err && <ErrorNotice error={err} />}
      {who && <Proposal who={who} email={email} contacts={contacts}
                        onDone={onDone} onCancel={() => { setWho(null); onCancel?.() }} />}
    </div>
  )
}

/**
 * 收信时已经判好的那一个(2026-10-07):名字、机构、来路直接摆出来,问你加不加。
 *
 * 判地址那一步(classify)早把这些写进了判定表,0163 把它们端到视图上。所以这里**不再要你先点「这是谁?」**
 * 让模型把同一批信重读一遍——那是判过的事又判一遍,还得一个个去点(8/13 之前的「等你点头」就是这个样子,
 * 他记得那个体验)。判得不够、想让它上网查机构和头衔,「再查查」还是那条老路。
 */
function Ask({ r, contacts, checked, onCheck, onDone }) {
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState(null)        // null | 'no' | 'added'
  const [deep, setDeep] = useState(false)          // 「再查查」:走老的那条读信 + 上网
  const org = r.判定 === 'shared_box'
  const title = r.名字 || r.信头署名 || (org ? r.机构 : null) || r.email
  const add = async () => {
    if (busy) return
    setBusy(true)
    try {
      await adopt({ email: r.email, verdict: r.判定, name: r.名字 || r.信头署名 || null,
                    org: r.机构 || (org ? r.email.split('@')[1] : null), role: r.头衔 || null, why: r.来路 || null })
      setState('added'); onDone?.()
    } catch (e) { reportError(e, t('没加上')) } finally { setBusy(false) }
  }
  // 不要:记成「你判的,跟业务无关」——以后自动判定也翻不回来;撤回就是原样判回去
  const no = async (undo = false) => {
    if (busy) return
    setBusy(true)
    try {
      await overrideVerdict({ email: r.email, verdict: r.判定 || 'person', business: undo, why: r.来路, name: r.名字, org: r.机构, role: r.头衔 })
      setState(undo ? null : 'no')
    } catch (e) { reportError(e, t('没记上')) } finally { setBusy(false) }
  }
  if (state === 'no') {
    return (
      <div className="ask ask-gone">
        <span><Veil>{title}</Veil> {t('不加了，以后不再问')}</span>
        <button className="lnk" disabled={busy} onClick={() => no(true)}>{t('撤回')}</button>
      </div>
    )
  }
  if (state === 'added') return <div className="ask ask-gone"><span><Veil>{title}</Veil> {t('加进通讯录了，往来信正在归到他名下')}</span></div>
  if (deep) return <One email={r.email} meta={r} contacts={contacts} onDone={onDone} onCancel={() => setDeep(false)} />
  return (
    <div className={'ask' + (busy ? ' ask-busy' : '')}>
      {onCheck && <input type="checkbox" className="ask-x" checked={checked} disabled={busy} onChange={(e) => onCheck(r.email, e.target.checked)} />}
      <div className="ask-body">
        <div className="ask-top">
          <b><Veil>{title}</Veil></b>
          {(r.机构 || r.头衔) && !org && <span className="ask-org"><Veil>{[r.机构, r.头衔].filter(Boolean).join(' · ')}</Veil></span>}
          <span className={'ask-kind' + (org ? ' is-org' : '')}>{org ? t('机构信箱') : t('人')}</span>
        </div>
        {title !== r.email && <div className="ask-mail"><Veil>{r.email}</Veil></div>}
        {r.来路 && <p className="ask-why"><Veil>{r.来路}</Veil></p>}
        <div className="ask-meta">
          {t('你发去 {a} · 他发来 {b}', { a: r.你发去的, b: r.他发来的 })} · {md(r.第一次)}{r.第一次 !== r.最近一次 ? ` → ${md(r.最近一次)}` : ''}
          {r.最近主题?.length > 0 && <> · <Veil>{[...new Set(r.最近主题)].map((x) => t('「{x}」', { x })).join(' ')}</Veil></>}
        </div>
        {r.出现在哪些机会线?.length > 0 && <div className="ask-meta">{t('出现在：')}{r.出现在哪些机会线.join(' · ')}</div>}
      </div>
      <div className="ask-act">
        <button className="nopen" disabled={busy} onClick={add}>{busy ? t('加着…') : org ? t('登记成机构信箱') : t('加进通讯录')}</button>
        <button className="lnk" disabled={busy} onClick={() => no(false)}>{t('不要')}</button>
        <button className="lnk ask-deep" disabled={busy} onClick={() => setDeep(true)} title={t('让 Fairwind 读信、上网查他的机构和头衔')}>{t('再查查')}</button>
      </div>
    </div>
  )
}

export default function Strangers({ rows = [], contacts = [], onDone }) {
  const [typed, setTyped] = useState('')
  const [asking, setAsking] = useState(null)   // 你手敲的那个地址
  const [pick, setPick] = useState(() => new Set())
  const task = useBgTask()
  const batch = task && !task.finished ? task : null   // 一起加的时候:进度在右下角小窗里
  const judged = rows.filter((r) => r.判定)     // 收信时判好的:直接问加不加
  const others = rows.filter((r) => !r.判定)    // 抄送 / 引荐进来的(0121):还走老的认人那条
  const onCheck = (email, on) => setPick((p) => { const n = new Set(p); if (on) n.add(email); else n.delete(email); return n })
  // 一起加:交给页面层的后台任务跑(切页面不断),进度在右下角;每加完十个刷一次名单,加好的就从这儿消失
  const addPicked = () => {
    const list = judged.filter((r) => pick.has(r.email))
    setPick(new Set())
    runAdopt(list, { onProgress: onDone, onDone })
  }

  return (
    <section className="psect">
      <div className="psect-h">
        <h2>{t('加人')}</h2>
        {rows.length > 0 && <span className="pcount">{t('{n} 个地址还不认识', { n: rows.length })}</span>}
      </div>

      {/* 你手上有个邮箱就粘进来。Gmail 网页链接不行——那串 id 跟 API 用的是
          两套编码，Google 没给转换的路子（试过 get_thread 和 rfc822msgid，都空）。 */}
      <div className="pfind" style={{ marginBottom: 14 }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)}
               placeholder={t('粘一个邮箱地址，我去信箱里查他是谁')}
               onKeyDown={(e) => { if (e.key === 'Enter' && typed.includes('@')) setAsking(typed.trim().toLowerCase()) }} />
        <button className="lnk" disabled={!typed.includes('@')}
                onClick={() => setAsking(typed.trim().toLowerCase())}>{t('查')}</button>
      </div>

      {asking && (
        <One email={asking} contacts={contacts}
             onDone={() => { setAsking(null); setTyped(''); onDone?.() }}
             onCancel={() => setAsking(null)} />
      )}

      {judged.length > 0 && (
        <>
          <div className="ask-bar">
            <p className="pnone" style={{ padding: 0 }}>
              {t('收信时认出这些人在跟你谈事。加进来，')}<b>{t('他名下所有历史往来会当场归位')}</b>{t('，不是从今天开始记。')}
            </p>
            <span className="sp" />
            {batch ? <span className="pf-note">{t('正在加 {done} / {total}，进度在右下角', { done: batch.done, total: batch.total })}</span> : <>
              <button className="lnk" onClick={() => setPick(pick.size === judged.length ? new Set() : new Set(judged.map((r) => r.email)))}>
                {pick.size === judged.length ? t('全不选') : t('全选')}
              </button>
              {pick.size > 0 && <button className="nopen" onClick={addPicked}>{t('把选中的 {n} 个加进来', { n: pick.size })}</button>}
            </>}
          </div>
          {judged.map((r) => (
            <Ask key={r.email} r={r} contacts={contacts} checked={pick.has(r.email)} onCheck={batch ? null : onCheck} onDone={onDone} />
          ))}
        </>
      )}
      {others.length > 0 && (
        <>
          <p className="pnone">
            {t('这几个是被抄送、被引荐进来的，信里看不出他是谁。点「这是谁？」让它去读信、上网查。')}
          </p>
          {others.map((r) => (
            <One key={r.email} email={r.email} meta={r} contacts={contacts} onDone={onDone} />
          ))}
        </>
      )}
    </section>
  )
}
