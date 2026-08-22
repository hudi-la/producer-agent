import { md, day } from '../lib/when.js'
import React, { useEffect, useMemo, useState } from 'react'
import Strangers from './Strangers.jsx'
import { stateLine, whyLine } from '../lib/stateText.js'

// 「人际管理」—— 人这一层。
//
// 设计稿：docs/specs/2026-08-08-people-layer-design.md
//
// 这一页的主角是**找**，不是浏览。
// 一人一张卡是对的，但卡是你找到他之后看的东西，不该占满这一页——
// 四个人的时候网格卡片勉强能看，等扫完老邮箱几千个人进来就废了。搜索框不会。
//
// 所以只有两样：一个搜索框、一份密行通讯录。
//
// 「现在该动的」原来在这儿，现在整块挪去了**顶栏那个 🔔**。
// 理由是同一件事不该有两个位置：「他回你了」原来在机会线是卡上一句事实、
// 在这儿是一条由头，两套代码两种措辞。合成一套之后，由头只有一个入口。
// 见 docs/specs/2026-08-18-notifications-design.md
//
// **这儿也没有过卡。** 队列是「你还欠着几件事」，那是项目争取那边的形状。

const SRC = { email: '来自那封信', checkin: '你打的卡', meet: '你记的一笔' }
const CH  = { email: '邮箱', wechat: '微信', sms: '短信', whatsapp: 'WhatsApp', ig: 'IG', phone: '电话' }


/** 用什么找他。channels 空着就退回 email 那一列——它一直是主渠道。 */
function channelsOf(c) {
  const list = Array.isArray(c.channels) ? c.channels : []
  if (list.length) return list
  return c.email ? [{ kind: 'email', value: c.email }] : []
}

// 人的事那两个区。跟通知栏同一套行组件的形状、同一份措辞（stateText.js）——
// 装的是**不同的事**（人的事 vs 线的事），不是同一件事的两个位置：
// 分家的判据在 lib/notifications.js 的 goesTo。
function PeopleDue({ notes, onHandled, onOpenState }) {
  const [waitOpen, setWaitOpen] = useState(false)
  const due = notes?.due || [], waiting = notes?.waiting || []
  if (!due.length && !waiting.length) return null
  const Row = ({ it }) => (
    <div className="nrow">
      <div className="nrow-b">
        <div className="nrow-h">
          <button className="nname" onClick={() => onOpenState(it)}>{it.name || '未具名联系人'}</button>
        </div>
        <div className="nrow-w">{stateLine(it)}</div>
        {whyLine(it) && <div className="nrow-y">{whyLine(it)}</div>}
      </div>
      <div className="nrow-a">
        {it.zone === 'due' && (
          <button className="nbtn" title="已处理 —— 记一笔，留痕迹" aria-label="已处理"
                  onClick={() => onHandled(it)}>✓</button>
        )}
        <button className="nopen" onClick={() => onOpenState(it)}>打开卡片</button>
      </div>
    </div>
  )
  return (
    <section className="ppl-due">
      <div className="psect-h"><h2>该动的</h2><span className="pcount">{due.length} 件</span></div>
      {due.length
        ? due.map((it) => <Row key={it.key} it={it} />)
        : <p className="pnone">现在没有到点的。</p>}
      {waiting.length > 0 && (
        <>
          <button className="nfold" onClick={() => setWaitOpen((x) => !x)}>
            {waitOpen ? '▾' : '▸'} 等待（{waiting.length}）
          </button>
          {waitOpen && waiting.map((it) => <Row key={it.key} it={it} />)}
        </>
      )}
    </section>
  )
}

export default function People({
  contacts = [], orgs = [], strangers = [],
  fellBack = null, onOpen, onOpenOrg, onAdded,
  // 人的事那两个区（该动的 / 等待）。数据和通知栏同一份 v_pa_state，
  // 分家之后人的那一半落在这儿。
  notes = null, onHandled, onOpenState,
  // 抽屉的开关在顶栏（工具条）上，跟项目争取那边一个位置，所以状态在 App 手里
  bookOpen = false, onCloseBook,
}) {
  const [q, setQ] = useState('')

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
            你会写信的对象都在这儿：人、机构、机构的共享信箱。
            <b>人的事</b>（回谢介绍人、见面后的信、只关乎这个人的回信）列在下面的
            「该动的」里；<b>机会线的事</b>在顶栏那个 🔔 —— 判据是这件事挂在哪张卡上。
          </p>
        </header>

        {/* 人的事：该动的 / 等待。8/19 早上删过一次（理由是「同一件事两个位置」），
            当天又装回来了 —— 这次两栏装的是不同的事，合并规则保证一件事只出现一次。 */}
        <PeopleDue notes={notes} onHandled={onHandled} onOpenState={onOpenState} />

        {/* 通讯录收起来了，这一页就没别的了（「现在该动的」挪去了 🔔）。
            **不留死白页** —— 说清它去哪了、怎么叫回来。 */}
        {!bookOpen && contacts.length > 0 && (
          <p className="pnone">
            通讯录收起来了。右上角那颗「通讯录」再点一下就回来。
          </p>
        )}

        {/* 空页可以，骗人不行 —— 说清是「库里真没有」还是「没连上」。 */}
        {!contacts.length && (
          <p className="pnone">
            {fellBack === 'no-config' ? '没连上数据库（.env.local 里的 VITE_SUPABASE_* 没填）。'
             : fellBack === 'query-failed' ? '连上了但查询报错——名片读不出来，不是库里没人。'
             : '库里一个人都没有。上面工具条拉开通讯录，粘个邮箱，我去信箱里查他是谁。'}
          </p>
        )}

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
