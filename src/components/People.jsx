import React, { useMemo, useState } from 'react'
import { cuesFor } from '../lib/cues.js'
import { upsertContact } from '../lib/people.js'

// 「人际管理」—— 人这一层。
//
// 设计稿：docs/specs/2026-08-08-people-layer-design.md
//
// 这一页的主角是**找**，不是浏览。
// 一人一张卡是对的，但卡是你找到他之后看的东西，不该占满这一页——
// 四个人的时候网格卡片勉强能看，等扫完老邮箱几千个人进来就废了。搜索框不会。
//
// 所以只有三样：一个搜索框、一段「现在该动的」、一份密行通讯录。
//
// **这儿没有过卡。** 队列是「你还欠着几件事」，那是项目争取那边的形状；
// 人这一层推着走的是由头，而由头在这页上就是一行字——看见了就点进去办，
// 不需要再排成一摞让你一张张翻。

const SRC = { email: '来自那封信', checkin: '你打的卡', meet: '你记的一笔' }
const CH  = { email: '邮箱', wechat: '微信', sms: '短信', whatsapp: 'WhatsApp', ig: 'IG', phone: '电话' }

const md = (s) => {
  if (!s) return null
  const [, m, d] = String(s).split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 用什么找他。channels 空着就退回 email 那一列——它一直是主渠道。 */
function channelsOf(c) {
  const list = Array.isArray(c.channels) ? c.channels : []
  if (list.length) return list
  return c.email ? [{ kind: 'email', value: c.email }] : []
}

export default function People({
  contacts = [], msgsByContact = {}, fellBack = null, onOpen, onAdded,
}) {
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', org: '', intro_by: '' })
  const [busy, setBusy] = useState(false)

  const byId = useMemo(() => Object.fromEntries(contacts.map((c) => [c.id, c])), [contacts])

  // 一次算出今天，所有人共用 —— 免得列表渲染到一半跨过午夜，前后两半用两个「今天」。
  const acting = useMemo(() => {
    const today = new Date()
    const out = []
    for (const c of contacts) {
      for (const cue of cuesFor(c, msgsByContact[c.id] || [],
        { today, introName: byId[c.intro_by]?.name })) out.push({ c, cue })
    }
    // 停了的（碰满三次那种）排后面、灰着：不吵你，但不许消失。
    return out.sort((a, b) => (a.cue.stopped ? 1 : 0) - (b.cue.stopped ? 1 : 0))
  }, [contacts, msgsByContact, byId])
  const live = acting.filter((x) => !x.cue.stopped).length

  const key = q.trim().toLowerCase()
  const found = key
    ? contacts.filter((c) => [c.name, c.org, c.role, c.email, c.notes]
        .filter(Boolean).some((s) => String(s).toLowerCase().includes(key)))
    : null

  const sorted = useMemo(
    () => [...contacts].sort((a, b) => String(b.last_touch_at || '').localeCompare(a.last_touch_at || '')),
    [contacts])

  const add = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || busy) return
    setBusy(true)
    try {
      await upsertContact({
        name: form.name.trim(),
        email: form.email.trim() || null,
        org: form.org.trim() || null,
        intro_by: form.intro_by || null,
      })
      setForm({ name: '', email: '', org: '', intro_by: '' })
      setAdding(false)
      onAdded?.()
    } catch (err) {
      alert('没加上：' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const Row = ({ c }) => (
    <button className="prow" onClick={() => onOpen?.(c)}>
      <span className="prow-n">{c.name || '未具名联系人'}</span>
      <span className="prow-s">{[c.org, c.role].filter(Boolean).join(' · ')}</span>
      <span className="prow-sp" />
      <span className="prow-ch">
        {channelsOf(c).map((x, i) => <span key={i} className="pchip">{CH[x.kind] || x.kind}</span>)}
      </span>
      {c.pursuits?.length > 0 && <span className="pchip">{c.pursuits.length} 条线</span>}
      <span className="prow-w">{c.last_touch_at ? md(c.last_touch_at) : '—'}</span>
    </button>
  )

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>人际管理</h1>
          <p className="note">
            一份能搜的通讯录，加上<b>现在该动的那几个</b>。推着走的不是阶段和截止，是由头——
            该 bump 了 / 到日子了 / 还没回谢介绍人 / 见面 48 小时信。
          </p>
        </header>

        <div className="pfind">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
               stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="6" cy="6" r="4.4" /><path d="M9.3 9.3 13 13" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="找谁？名字、机构、邮箱" autoComplete="off" />
          <button className="lnk" onClick={() => setAdding((v) => !v)}>
            {adding ? '不加了' : '加个人'}
          </button>
        </div>

        {adding && (
          <form className="padd" onSubmit={add}>
            <input autoFocus placeholder="名字（必填）" value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="邮箱" value={form.email}
                   onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input placeholder="机构" value={form.org}
                   onChange={(e) => setForm({ ...form, org: e.target.value })} />
            {/* 谁介绍的：warm intro 是有分量的资产，而且它撑着「还没回谢」那条由头。 */}
            <select value={form.intro_by}
                    onChange={(e) => setForm({ ...form, intro_by: e.target.value })}>
              <option value="">谁介绍的（可不填）</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name || '未具名'}</option>)}
            </select>
            <button className="lnk" disabled={busy || !form.name.trim()}>
              {busy ? '加着…' : '加进去'}
            </button>
          </form>
        )}

        {/* 空页可以，骗人不行 —— 说清是「库里真没有」还是「没连上」。 */}
        {!contacts.length && (
          <p className="pnone">
            {fellBack === 'no-config' ? '没连上数据库（.env.local 里的 VITE_SUPABASE_* 没填）。'
             : fellBack === 'query-failed' ? '连上了但查询报错——名片读不出来，不是库里没人。'
             : '库里一个人都没有。上面「加个人」加第一个。'}
          </p>
        )}

        {found ? (
          <section className="psect">
            <div className="psect-h"><h2>找到的</h2><span className="pcount">{found.length} 个</span></div>
            <div className="prows">
              {found.length
                ? found.map((c) => <Row key={c.id} c={c} />)
                : <p className="pnone">没有叫这个的。「加个人」把他加进来。</p>}
            </div>
          </section>
        ) : contacts.length > 0 && (
          <>
            <section className="psect">
              <div className="psect-h"><h2>现在该动的</h2><span className="pcount">{live} 件</span></div>
              {acting.length ? acting.map(({ c, cue }) => (
                <button key={c.id + cue.via}
                        className={'pcue' + (cue.stopped ? ' stopped' : '')}
                        onClick={() => onOpen?.(c)}>
                  <span className="prow-n">{c.name || '未具名联系人'}</span>
                  <span className="pcue-w">{cue.why}</span>
                </button>
              )) : <p className="pnone">现在没有该动的。这是好事，不是漏了什么。</p>}
            </section>

            <section className="psect">
              <div className="psect-h">
                <h2>通讯录</h2>
                <span className="pcount">{contacts.length} 人 · 按上次碰排</span>
              </div>
              <div className="prows">{sorted.map((c) => <Row key={c.id} c={c} />)}</div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
