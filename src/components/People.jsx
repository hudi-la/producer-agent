import React, { useMemo, useState } from 'react'
import { TASK_DESC } from '../data/tasksSeed.js'
import { cuesFor } from '../lib/cues.js'
import { upsertContact } from '../lib/people.js'

// 「人际管理」—— 人这一层。
//
// 设计稿：docs/specs/2026-08-08-people-layer-design.md
//
// 原来这页写着「这里管的是没有 proposal 压力的关系」，那句话是**错的**：
// Kirk / Sarah / Mattie 恰恰挂在机会线上，你却要在这儿看他们的名片；
// 而 Maisa 一条机会线都没有。真正的分法是——
//
//   人是一个独立的层。项目争取和人际管理是看这一层的两个入口，共用同一张名片。
//   区别在**谁在推你**：有交付压力的，机会线推；没有的，由头推。
//
// 这一页不做四层分层（有来有往 / 久没动 / 从没回过 / 办完事的）。
// 分层的全部价值在人多的时候，现在库里十来个人，它只会是负担。
// 判据记在设计稿缓办三里，跟扫老邮箱那一刀一起做。

const SRC = { email: '来自那封信', checkin: '你打的卡', meet: '你记的一笔' }
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
const CH = { email: '邮箱', wechat: '微信', sms: '短信', whatsapp: 'WhatsApp', ig: 'IG', phone: '电话' }

export default function People({
  contacts = [], msgsByContact = {}, tasks = [], onOpen, onAdded, fellBack,
}) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', org: '', intro_by: '' })
  const [busy, setBusy] = useState(false)

  const byId = useMemo(
    () => Object.fromEntries(contacts.map((c) => [c.id, c])), [contacts])

  // 一次算出今天，所有人共用 —— 免得列表渲染到一半跨过午夜，前后两半用两个「今天」。
  const today = useMemo(() => new Date(), [contacts])

  const rows = contacts.map((c) => ({
    c,
    cues: cuesFor(c, msgsByContact[c.id] || [], { today, introName: byId[c.intro_by]?.name }),
  }))

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

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>人际管理</h1>
          <p className="note">
            一人一张卡，不挂在任何机会线上。推着走的不是阶段和截止，是<b>由头</b>——
            该 bump 了 / 到日子了 / 还没回谢介绍人 / 见面 48 小时信。
          </p>
        </header>

        <div className="ppl-bar">
          <button className="lnk" onClick={() => setAdding((v) => !v)}>
            {adding ? '不加了' : '加个人'}
          </button>
          <span className="ppl-count">{contacts.length} 个人</span>
        </div>

        {adding && (
          <form className="ppl-add" onSubmit={add}>
            <input autoFocus placeholder="名字（必填）" value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="邮箱" value={form.email}
                   onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input placeholder="机构" value={form.org}
                   onChange={(e) => setForm({ ...form, org: e.target.value })} />
            {/* 谁介绍的：warm intro 在美国是有分量的资产，而且它撑着由头③。 */}
            <select value={form.intro_by} onChange={(e) => setForm({ ...form, intro_by: e.target.value })}>
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
          <p className="soon-note">
            {fellBack === 'no-config' ? '没连上数据库（.env.local 里的 VITE_SUPABASE_* 没填）。'
             : fellBack === 'query-failed' ? '连上了但查询报错——名片读不出来，不是库里没人。'
             : '库里一个人都没有。上面「加个人」加第一个，或者跑一遍 0033 迁移把邮件里的人认出来。'}
          </p>
        )}

        <div className="ppl-list">
          {rows.map(({ c, cues }) => (
            <button key={c.id} className="pcard ppl-card" onClick={() => onOpen?.(c)}>
              <div className="ppl-name">{c.name || '未具名联系人'}</div>
              {(c.org || c.role) && (
                <div className="ppl-sub">{[c.org, c.role].filter(Boolean).join(' · ')}</div>
              )}

              {/* 用什么找他。每个人不一样——这是这一层跟机会线最不一样的地方。 */}
              {channelsOf(c).length > 0 && (
                <div className="ppl-ch">
                  {channelsOf(c).map((x, i) => (
                    <span key={i} className="ppl-chip">{CH[x.kind] || x.kind}</span>
                  ))}
                </div>
              )}

              {/* 日期永远带来源。没有来源的日期是来路不明的数字。 */}
              <div className="ppl-meta">
                {c.last_touch_at
                  ? <>上次 {md(c.last_touch_at)} · {SRC[c.last_touch_src] || '来源不明'}</>
                  : <span className="ppl-dim">还没碰过</span>}
                {c.pursuits?.length > 0 && <> · 挂着 {c.pursuits.length} 条线</>}
              </div>

              {cues.map((q) => (
                <div key={q.via} className={`cue cue-${q.via}${q.stopped ? ' cue-stopped' : ''}`}>
                  {q.why}
                </div>
              ))}
            </button>
          ))}
        </div>

        {tasks.length > 0 && (
          <div className="soon">
            <div className="soon-h">归这儿的造卡任务</div>
            <ul className="soon-list">
              {tasks.map((t) => (
                <li key={t.id || t.type}>
                  <b>{t.name}</b> —— {TASK_DESC[t.type] || t.type}
                  <span className="soon-state">{t.enabled ? '已开' : '未接'}</span>
                </li>
              ))}
            </ul>
            <p className="soon-note">
              这条任务还没接。它的活现在由<b>四种由头</b>顶着——由头是算出来的，
              不需要一条定时任务去巡逻。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
