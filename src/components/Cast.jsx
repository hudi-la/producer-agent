import ErrorNotice from './ErrorNotice.jsx'
import React, { useEffect, useState } from 'react'
import { fetchParties, attachParty, detachParty, fetchCandidates } from '../lib/pursuitCast.js'
import Veil from './Veil.jsx'
import { t } from '../i18n/index.js'

// 这条线上都有谁。
//
// 为什么这一格是必需的，不是锦上添花：
//
// pursuit_messages 有两个主人栏，pa_add_mail 按地址填 contact_id，
// pursuit_id 要另外传——认领走的是「人」那条路，传的是 null。于是信全挂在
// 人身上，一条线都没挂上：Brooke 回了信，她的名片上好好的，
// 「合作开课 · LA County Arboretum」那条线上却是 0 封。
//
// 而 pursuits.contact_id 是**单个**的，装不下一条线牵扯的一伙人
// （Brooke 那封还抄送了 Rachel；SFCB 那条线上有 Sarah 和 workshops@ 两个）。
//
// 挂上之后线的往来是**推导**出来的：他以后再来信，不用做任何事就会出现。
// 摘掉也只摘关系——**信还在那个人名下，一封都不会少**。

export default function Cast({ pursuitId, onOpenPerson, onChanged }) {
  const [rows, setRows] = useState(null)
  const [adding, setAdding] = useState(false)
  const [cand, setCand] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState(null)

  async function reload() {
    try { setRows(await fetchParties(pursuitId)) } catch (e) { setErr(e.message) }
  }
  useEffect(() => { reload() }, [pursuitId])

  async function openAdd() {
    setAdding(true); setQ('')
    if (!cand) { try { setCand(await fetchCandidates()) } catch (e) { setErr(e.message) } }
  }

  async function add(x) {
    try {
      await attachParty(pursuitId, x.id ? { contactId: x.id } : { mailbox: x.email })
      setAdding(false); setQ('')
      await reload(); onChanged?.()
    } catch (e) { setErr(e.message) }
  }

  async function drop(r) {
    // 说清楚摘掉会怎样。会怕的是「信是不是也没了」——不会，所以直接讲明白。
    if (!confirm(t('把 {name} 从这条线上摘掉？\n\n跟他的 {n} 封往来一封都不会少，只是不再显示在这条线上。', { name: r.name, n: r.mails }))) return
    try { await detachParty(r.id); await reload(); onChanged?.() } catch (e) { setErr(e.message) }
  }

  if (rows === null) return null

  const s = q.trim().toLowerCase()
  const hit = (t) => !s || String(t || '').toLowerCase().includes(s)
  const on = new Set(rows.map((r) => r.contact_id || r.mailbox_email))
  const people = (cand?.people || []).filter((c) => !on.has(c.id) && (hit(c.name) || hit(c.org)))
  const boxes = (cand?.mailboxes || []).filter((b) => !on.has(b.email) && (hit(b.email) || hit(b.org)))

  return (
    <div className="dsect">
      <p className="secttl">{t('相关的人')}</p>
      <div className="cast">
        {rows.length === 0 ? (
          <p className="empty">
            {t('这条线还没挂人。挂上之后，')}<b>{t('跟他的往来会自动出现在这条线上')}</b>{t('——以后他再来信也不用你做什么。')}
          </p>
        ) : rows.map((r) => (
          <div className="cast-row" key={r.id}>
            <button
              className="cast-who"
              disabled={r.is_mailbox}
              title={r.is_mailbox ? t('机构共享信箱，不是某个人，没有名片') : t('打开他的名片')}
              onClick={() => !r.is_mailbox && onOpenPerson?.({ id: r.contact_id, name: r.name })}
            >
              <b><Veil>{r.name}</Veil></b>
              {r.is_mailbox && <span className="cast-tag">{t('机构信箱')}</span>}
              {r.org && !r.is_mailbox && <span className="cast-org"><Veil>{r.org}</Veil></span>}
              {/* 不是你亲手挂的，就说清是怎么上来的：谁、哪天、抄送还是回信（0121） */}
              {r.note && r.added_by !== 'you' && <span className="cast-note"><Veil>{r.note}</Veil></span>}
            </button>
            <span className="cast-meta">
              {r.mails ? t('{n} 封', { n: r.mails }) : t('还没往来')}{r.last_at ? ` · ${String(r.last_at).slice(5).replace('-', '/')}` : ''}
            </span>
            <button className="lnk cast-x" onClick={() => drop(r)} title={t('从这条线上摘掉（信不会少）')}>{t('摘')}</button>
          </div>
        ))}

        {!adding ? (
          <button className="lnk cast-add" onClick={openAdd}>{t('＋ 挂一个人上来')}</button>
        ) : (
          <div className="cast-pick">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder={t('搜人名、机构，或机构信箱地址')} />
            <button className="lnk" onClick={() => setAdding(false)}>{t('算了')}</button>
            <div className="cast-list">
              {people.slice(0, 8).map((c) => (
                <button className="cast-opt" key={c.id} onClick={() => add(c)}>
                  <b><Veil>{c.name}</Veil></b>{c.org ? <span className="cast-org"><Veil>{c.org}</Veil></span> : null}
                </button>
              ))}
              {boxes.slice(0, 6).map((b) => (
                <button className="cast-opt" key={b.email} onClick={() => add(b)}>
                  <b><Veil>{b.email}</Veil></b><span className="cast-tag">{t('机构信箱')}</span>
                </button>
              ))}
              {!people.length && !boxes.length && (
                <p className="empty">{t('没搜到。还没进通讯录的人，先去人际管理那边认一下。')}</p>
              )}
            </div>
          </div>
        )}
        {err && <ErrorNotice error={err} context={t('保存更改')} />}
      </div>
    </div>
  )
}
