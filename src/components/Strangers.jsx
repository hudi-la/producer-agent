import React, { useState } from 'react'
import { claimEmail, markOrgMailbox, upsertContact } from '../lib/people.js'

// 「还不认识的地址」—— 加人的真入口。
//
// 原来这儿是让你贴一个 Gmail thread id。那不是人干的事：你手上有的是一封信，
// 不是一个内部编号。后来想改成让你贴邮件链接，其实也还是绕——
//
// **系统本来就知道有个陌生地址在跟你写信。** 它不该等你去告诉它，
// 它该自己把这几个地址摆出来，只问你一句：他是谁。
//
// 你回答之后，那个地址名下**所有历史往来当场归位**（pa_claim_email 干的），
// 不是从今天开始记——以前那些信本来就是他的。

const md = (s) => {
  if (!s) return '—'
  const [, m, d] = String(s).split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 从信头署名里抠个像样的默认名字：「Maisa Chen <m@x.edu>」→「Maisa Chen」 */
function guessName(row) {
  const raw = (row.信头署名 || '').replace(/<[^>]*>/g, '').replace(/^["']|["']$/g, '').trim()
  if (raw && !raw.includes('@')) return raw
  // 没有署名就拿地址的用户名凑一个，你自己再改
  return (row.email || '').split('@')[0].replace(/[._-]+/g, ' ')
}

export default function Strangers({ rows = [], contacts = [], onDone }) {
  const [open, setOpen] = useState(null)     // 正在处理哪个地址
  const [mode, setMode] = useState('new')    // 'new' | 'existing' | 'org'
  const [name, setName] = useState('')
  const [pick, setPick] = useState('')
  const [org, setOrg] = useState('')
  const [busy, setBusy] = useState(false)

  if (!rows.length) return null

  const start = (r) => {
    setOpen(r.email); setMode('new')
    setName(guessName(r)); setPick(''); setOrg('')
  }

  const submit = async (r) => {
    if (busy) return
    setBusy(true)
    try {
      if (mode === 'org') {
        if (!org.trim()) throw new Error('要填机构名')
        await markOrgMailbox(r.email, org.trim(), null,
          `从「还不认识的地址」认的。${r.封数} 封往来。`)
      } else {
        let id = pick
        if (mode === 'new') {
          if (!name.trim()) throw new Error('要填名字')
          const c = await upsertContact({ name: name.trim(), email: r.email })
          id = c.id
        }
        if (!id) throw new Error('要选一个人')
        // 认领：这个地址名下所有历史往来当场归位
        await claimEmail(r.email, id)
      }
      setOpen(null)
      onDone?.()
    } catch (e) {
      alert('没弄成：' + e.message)
    } finally { setBusy(false) }
  }

  return (
    <section className="psect">
      <div className="psect-h">
        <h2>还不认识的地址</h2>
        <span className="pcount">{rows.length} 个</span>
      </div>
      <p className="pnone" style={{ paddingTop: 0 }}>
        这几个地址在跟你来往，但库里不知道是谁。说一句他是谁，
        <b>他名下所有历史往来会当场归位</b> —— 不是从今天开始记。
      </p>

      {rows.map((r) => (
        <div key={r.email} className="stranger">
          <div className="stranger-h">
            <span className="prow-n">{r.信头署名 || r.email}</span>
            {r.信头署名 && <span className="pf-note">{r.email}</span>}
            <span className="prow-sp" />
            <span className="pchip">{r.封数} 封</span>
            <span className="pf-note">
              他发来 {r.他发来的} · 你发去 {r.你发去的} · {md(r.第一次)}–{md(r.最近一次)}
            </span>
            {open !== r.email && (
              <button className="lnk" onClick={() => start(r)}>他是谁？</button>
            )}
          </div>

          {r.出现在哪些机会线?.length > 0 && (
            <div className="pf-note">出现在：{r.出现在哪些机会线.join(' · ')}</div>
          )}

          {open === r.email && (
            <div className="stranger-form">
              <div className="stranger-modes">
                {[['new', '是个新人'], ['existing', '是库里已有的人'], ['org', '是机构的共享信箱']]
                  .map(([m, label]) => (
                    <button key={m} className={'smode' + (mode === m ? ' on' : '')}
                            onClick={() => setMode(m)}>{label}</button>
                  ))}
              </div>

              {mode === 'new' && (
                <input value={name} onChange={(e) => setName(e.target.value)}
                       placeholder="他叫什么" autoFocus />
              )}
              {mode === 'existing' && (
                <select value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">选一个人 —— 这是他的另一个邮箱</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              {mode === 'org' && (
                <input value={org} onChange={(e) => setOrg(e.target.value)}
                       placeholder="哪个机构的共享箱（例如 CultureHub）" autoFocus />
              )}

              <div className="stranger-btns">
                <button className="lnk" disabled={busy} onClick={() => submit(r)}>
                  {busy ? '弄着…' : mode === 'org' ? '记成机构信箱' : `认领这 ${r.封数} 封`}
                </button>
                <button className="lnk" disabled={busy} onClick={() => setOpen(null)}>算了</button>
              </div>

              {mode === 'existing' && (
                <p className="pf-note">
                  人会换邮箱。选了之后旧地址<b>不删</b>——它是那些历史往来的钥匙。
                </p>
              )}
              {mode === 'org' && (
                <p className="pf-note">
                  共享信箱署的是一组人，不是一个人。它的往来会从所有名片上撤下来，只留在机会线上。
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
