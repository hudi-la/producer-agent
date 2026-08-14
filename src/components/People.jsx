import React, { useEffect, useMemo, useState } from 'react'
import { cuesFor, cueKey } from '../lib/cues.js'
import { loadOff, turnOff, turnAllOn } from '../lib/cueoff.js'
import Strangers from './Strangers.jsx'

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
  contacts = [], orgs = [], strangers = [], msgsByContact = {},
  fellBack = null, onOpen, onOpenOrg, onAdded,
  // 抽屉的开关在顶栏（工具条）上，跟项目争取那边一个位置，所以状态在 App 手里
  bookOpen = false, onCloseBook,
}) {
  const [q, setQ] = useState('')
  // 你关掉的那些由头。存 localStorage —— 关掉不是事实，是「先不看它」。
  const [off, setOff] = useState(loadOff)

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

  const shown = acting.filter((x) => !off.has(cueKey(x.c.id, x.cue)))
  const hidden = acting.length - shown.length
  const live = shown.filter((x) => !x.cue.stopped).length

  // 通讯录装的是**你会写信的对象**，不是只装人。机构和它的共享信箱也在里面。
  const entries = useMemo(() => [
    ...contacts.map((c) => ({ kind: 'person', id: c.id, c, at: c.last_touch_at })),
    ...orgs.map((o) => ({ kind: 'org', id: o.org, o, at: o.last_touch_at })),
  ].sort((a, b) => String(b.at || '').localeCompare(a.at || '')), [contacts, orgs])

  // Esc 收起抽屉。搜索框里打了字的话，第一下 Esc 先清搜索——
  // 一下把整个抽屉关掉，你刚打的那几个字就白打了。
  useEffect(() => {
    if (!bookOpen) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (q) setQ('')
      else onCloseBook?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [bookOpen, q, onCloseBook])

  const key = q.trim().toLowerCase()
  const hit = (e) => {
    const bag = e.kind === 'person'
      ? [e.c.name, e.c.role, e.c.notes, ...(e.c.emails || []).map((x) => x.email),
         ...(e.c.orgs || []).map((x) => x.org)]
      : [e.o.org, ...(e.o.mailboxes || []).map((m) => m.email + ' ' + (m.label || '')),
         ...(e.o.people || []).map((p) => p.name)]
    return bag.filter(Boolean).some((s) => String(s).toLowerCase().includes(key))
  }
  const found = key ? entries.filter(hit) : null


  /** 现在挂着的机构（离开了的不在这儿显示，那是名片里的事）。 */
  const nowOrg = (c) => {
    const cur = (c.orgs || []).find((o) => !o.until)
    return cur ? [cur.org, cur.role].filter(Boolean).join(' · ')
      : ((c.orgs || []).length ? '（现在没挂机构）' : [c.org, c.role].filter(Boolean).join(' · '))
  }

  const Row = ({ e }) => e.kind === 'org' ? (
    <button className="prow" onClick={() => onOpenOrg?.(e.o)}>
      <span className="prow-n">{e.o.org}</span>
      <span className="pchip org">机构</span>
      <span className="prow-s">
        {e.o.mailboxes?.[0]?.email || <span className="pf-empty">没有共享信箱</span>}
      </span>
      <span className="prow-sp" />
      <span className="pchip">
        {e.o.people_now} 人{e.o.people_past ? ` · 走了 ${e.o.people_past}` : ''}
      </span>
      {e.o.mail_count > 0 && <span className="pchip">{e.o.mail_count} 封</span>}
      <span className="prow-w">{e.o.last_touch_at ? md(e.o.last_touch_at) : '—'}</span>
    </button>
  ) : (
    <button className="prow" onClick={() => onOpen?.(e.c)}>
      <span className="prow-n">{e.c.name || '未具名联系人'}</span>
      <span className="prow-s">{nowOrg(e.c)}</span>
      <span className="prow-sp" />
      <span className="prow-ch">
        {channelsOf(e.c).map((x, i) => <span key={i} className="pchip">{CH[x.kind] || x.kind}</span>)}
      </span>
      {e.c.pursuits?.length > 0 && <span className="pchip">{e.c.pursuits.length} 条线</span>}
      <span className="prow-w">{e.c.last_touch_at ? md(e.c.last_touch_at) : '—'}</span>
    </button>
  )

  return (
    <div className="page">
      <div className="page-inner ppl-inner">
        <header className="page-head">
          <h1>人际管理</h1>
          <p className="note">
            这一页只递一件事：<b>现在该动的那几个</b>。推着走的不是阶段和截止，是由头——
            他回你了 / 该 bump 了 / 到日子了 / 还没回谢介绍人 / 见面 48 小时信。
          </p>
        </header>

        {/* 空页可以，骗人不行 —— 说清是「库里真没有」还是「没连上」。 */}
        {!contacts.length && (
          <p className="pnone">
            {fellBack === 'no-config' ? '没连上数据库（.env.local 里的 VITE_SUPABASE_* 没填）。'
             : fellBack === 'query-failed' ? '连上了但查询报错——名片读不出来，不是库里没人。'
             : '库里一个人都没有。上面工具条拉开通讯录，粘个邮箱，我去信箱里查他是谁。'}
          </p>
        )}

        <section className="psect">
          <div className="psect-h"><h2>现在该动的</h2><span className="pcount">{live} 件</span></div>
          {shown.length ? shown.map(({ c, cue }) => (
            <div key={c.id + cue.via} className={'pcue' + (cue.stopped ? ' stopped' : '')}>
              <button className="pcue-open" onClick={() => onOpen?.(c)}>
                <span className="prow-n">{c.name || '未具名联系人'}</span>
                <span className="pcue-w">{cue.why}</span>
              </button>
              {/* 关掉这一条。**不改任何事实**——那封信、那个日期原样都在，
                  只是这台机器上先不看它。他再回你一封新的，这条会重新出现
                  （键锚在事实的日期上，见 cues.js 的 cueKey）。 */}
              <button className="pcue-x" title="先不看这条"
                      onClick={() => setOff((o) => turnOff(o, cueKey(c.id, cue)))}>✕</button>
            </div>
          )) : (
            <p className="pnone">
              {acting.length ? '该动的都被你关掉了。' : '现在没有该动的。这是好事，不是漏了什么。'}
            </p>
          )}

          {/* 关掉多少条都得说出来，而且永远留一条放回来的路。
              静默藏起来 = 你以为没有，其实有 —— 那是这个项目最不能忍的那种谎。 */}
          {hidden > 0 && (
            <p className="pnone pcue-off">
              还有 {hidden} 条被你关掉了。
              <button className="lnk" onClick={() => setOff(turnAllOn())}>都放回来</button>
            </p>
          )}
        </section>
      </div>

      {/* ── 通讯录抽屉 ─────────────────────────────────────────
          跟机会线那个抽屉同一套（.drawer：右侧固定、滑入、Esc 收起）。
          长得一样是故意的——它们是同一种东西：你临时拉开看一眼，看完收起。 */}
      {bookOpen && (
        <aside className="drawer ppl-drawer" aria-label="通讯录">
          <div className="pdrawer">
            <div className="pdrawer-h">
              <button className="back" onClick={() => onCloseBook?.()} aria-label="收起">
                <span aria-hidden="true">✕</span><span className="t"> 收起</span>
              </button>
              <h2>通讯录</h2>
              <span className="pcount">{contacts.length} 人 · {orgs.length} 机构</span>
            </div>

            <div className="pdrawer-body">
              <div className="pfind">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                     stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <circle cx="6" cy="6" r="4.4" /><path d="M9.3 9.3 13 13" />
                </svg>
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                       placeholder="找谁？名字、机构、邮箱" autoComplete="off" />
              </div>

              {/* 加人是往通讯录里加，所以它在这儿 */}
              {!found && <Strangers rows={strangers} contacts={contacts} onDone={onAdded} />}

              {found ? (
                <>
                  <div className="psect-h"><h2>找到的</h2><span className="pcount">{found.length} 个</span></div>
                  <div className="prows">
                    {found.length
                      ? found.map((e) => <Row key={e.kind + e.id} e={e} />)
                      : <p className="pnone">没有叫这个的。清空搜索框，粘他的邮箱加进来。</p>}
                  </div>
                </>
              ) : (
                <div className="prows">{entries.map((e) => <Row key={e.kind + e.id} e={e} />)}</div>
              )}
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
