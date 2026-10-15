import ErrorNotice from './ErrorNotice.jsx'
import React, { useState } from 'react'
import { adopt, markThread } from '../lib/mail.js'
import {
  cleanSubject, groupLine, memberNote, unknownMembers, knownMembers, genericMembers,
} from '../lib/groupText.js'
import Veil from './Veil.jsx'
import { t } from '../i18n/index.js'

// 一伙人（0122）：一串信里好几个人来回说话，其中还有人没进通讯录。
//
// 他的原话：「我在一个机构做事情，这个机构除了我之外，同时还联系了一大堆艺术家。
// 我也很愿意把他们都收进我的通讯录，并且写清楚是在哪个活动里合作过。」
//
// 一伙人一格、一个按钮。活动名预填成信的主题——「在哪个活动里合作过」这句话
// 该由他定，所以不自动收；但也不让他一个个点：十几个人一下收完。
// info@ 这种共享信箱不跟着收，留在下面「加人」那格单独认。
//
// 收人走的是 /mail/adopt 那个口，跟认一个陌生地址一模一样：建名片 → 认领地址
// （他名下的历史往来当场归位）→ 拉正文写摘要。所以要脑子开着。

function GroupRow({ g, onCollect, onSkip, busy, run }) {
  const [event, setEvent] = useState(() => cleanSubject(g.subject))
  const unknown = unknownMembers(g)
  const known = knownMembers(g)
  const generic = genericMembers(g)
  const names = (xs) => xs.map((m) => m.name || m.email)
  return (
    <div className={`gr gr-group ${busy ? 'gr-busy' : ''}`}>
      <div className="gr-body">
        <div className="gr-top">
          <b><Veil>{cleanSubject(g.subject)}</Veil></b>
          <span className="gr-kind is-group">{t('一伙人')}</span>
          {g.on_line && <span className="gr-kind"><Veil>{g.on_line}</Veil></span>}
        </div>
        <p className="gr-why"><Veil>{groupLine(g)}</Veil></p>
        {known.length > 0 && (
          <div className="gr-meta">{t('已经认识的：')}<Veil>{names(known).join(t('、'))}</Veil></div>
        )}
        <div className="gr-names">
          {t('还没进通讯录的 {n} 个：', { n: unknown.length })}
          {unknown.map((m) => (
            <span className={`gr-name ${m.name ? '' : 'is-bare'}`} key={m.email} title={m.email}>
              <Veil>{m.name || m.email}</Veil>
            </span>
          ))}
        </div>
        {generic.length > 0 && (
          <div className="gr-meta">
            <Veil>{names(generic).join(t('、'))}</Veil> {t('看着是共享信箱，不跟着一起收，留在下面单独认。')}
          </div>
        )}
        <label className="gr-event">
          {t('在哪个活动里合作过')}
          <input value={event} onChange={(e) => setEvent(e.target.value)} disabled={busy} />
        </label>
      </div>
      <div className="gr-act">
        <button className="lnk" disabled={busy || !event.trim() || !unknown.length}
                onClick={() => onCollect(g, event.trim())}>
          {run ? t('收着 {i}/{n}', { i: run.i, n: run.n }) : busy ? t('收着…') : t('把这 {n} 个都收进通讯录', { n: unknown.length })}
        </button>
        <button className="lnk gr-no" disabled={busy} onClick={() => onSkip(g)}>{t('这串不算')}</button>
      </div>
    </div>
  )
}

export default function Groups({ rows = [], onDone }) {
  const [busy, setBusy] = useState(null)     // 正在收的那一串 thread id
  const [run, setRun] = useState(null)       // {i, n}
  const [said, setSaid] = useState([])
  const [err, setErr] = useState(null)
  const say = (s) => setSaid((d) => [s, ...d].slice(0, 3))

  // 一个个走 adopt（每个要去 Gmail 拉正文写摘要），收完给这串打记号。
  // 一个没成不停，接着收下一个——跟「更新最新信息」一个节奏。
  async function collect(g, event) {
    const list = unknownMembers(g)
    if (!list.length) return
    setBusy(g.thread); setErr(null)
    let ok = 0, bad = 0, mails = 0
    const why = memberNote(g, event)
    // 同一伙里两个地址一个名字（Yunsang Cho 两个邮箱）：第二个地址挂到第一张名片上，
    // 别建两张。只在这一伙里认——跨伙同名可能真是两个人。
    const byName = new Map()
    for (let i = 0; i < list.length; i++) {
      setRun({ i: i + 1, n: list.length })
      const m = list[i]
      const key = (m.name || '').trim().toLowerCase()
      try {
        const out = await adopt({ email: m.email, name: m.name || null, org: m.org || null, verdict: 'person', why,
                                  contact_id: (key && byName.get(key)) || null })
        if (key && out?.contact_id && !byName.has(key)) byName.set(key, out.contact_id)
        ok++; mails += out.promoted || 0
      } catch (e) {
        bad++
        if (e.needsAuth) { setErr(`${e.message}——${e.fix || t('重新授权一次')}`); break }
        if (/fetch|Failed to fetch|ECONNREFUSED/i.test(String(e.message))) { setErr(t('脑子没开（npm run brain），收人要它去 Gmail 拉正文')); break }
      }
    }
    setRun(null); setBusy(null)
    if (ok) {
      try { await markThread(g.thread, 'collected', event) } catch (e) { setErr(e.message) }
      say(t('「{event}」这一伙：收了 {ok} 个，搬进来 {mails} 封', { event, ok, mails }) + (bad ? t('；{n} 个没成，这串还在上面', { n: bad }) : ''))
    }
    onDone?.()
  }

  async function skip(g) {
    setBusy(g.thread)
    try { await markThread(g.thread, 'skip'); onDone?.() }
    catch (e) { setErr(e.message) } finally { setBusy(null) }
  }

  if (!rows.length && !said.length) return null
  return (
    <section className="psect">
      <div className="psect-h">
        <h2>{t('一伙人')}</h2>
        {rows.length > 0 && <span className="pcount">{t('{n} 串', { n: rows.length })}</span>}
      </div>
      {rows.length > 0 && (
        <p className="pnone" style={{ paddingTop: 0 }}>
          {t('这几串信里')}<b>{t('好几个人来回说过话')}</b>{t('——同期的驻地、一个展的参展者、一个工作坊的学员。')}
          {' '}{t('写上在哪个活动里合作过，一下全收进通讯录，每张名片上都会记着这句。')}
        </p>
      )}
      {rows.map((g) => (
        <GroupRow key={g.thread} g={g}
                  busy={busy === g.thread} run={busy === g.thread ? run : null}
                  onCollect={collect} onSkip={skip} />
      ))}
      {said.map((s, i) => <p className="gr-ok" key={i}>{s}</p>)}
      {err && <ErrorNotice error={err} context={t('保存更改')} />}
    </section>
  )
}
