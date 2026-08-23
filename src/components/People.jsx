import { md, day } from '../lib/when.js'
import React, { useEffect, useMemo, useState } from 'react'
import Strangers from './Strangers.jsx'

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

export default function People({
  contacts = [], orgs = [], strangers = [],
  fellBack = null, onOpen, onOpenOrg, onAdded,
}) {
  const [q, setQ] = useState('')

  // 通讯录装的是**你会写信的对象**，不是只装人。机构和它的共享信箱也在里面。
  const entries = useMemo(() => [
    ...contacts.map((c) => ({ kind: 'person', id: c.id, c, at: c.last_touch_at })),
    ...orgs.map((o) => ({ kind: 'org', id: o.org, o, at: o.last_touch_at })),
  ].sort((a, b) => String(b.at || '').localeCompare(a.at || '')), [contacts, orgs])

  // Esc 清搜索框。原来它还兼着「收起抽屉」——抽屉撤了（见下面那段），
  // 只剩这一层：你打了字，一下 Esc 回到全部。
  useEffect(() => {
    if (!q) return
    const onKey = (e) => { if (e.key === 'Escape') setQ('') }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [q])

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
            该动的和在等的事<b>全部</b>在顶栏那个 🔔 里 —— 人的和机会线的一起排，
            不再按「挂在哪张卡上」分成两处。
          </p>
        </header>

        {/* 「该动的 / 等待」那两个区 2026-08-21 撤了，整个并进 🔔。
            当初分家是为了挡状态机还没做好时那一片假的「还需要回复」；
            噪音清掉之后，分家只剩副作用——最近的一场见面因为对方没挂在
            任何线上，就从 🔔 里消失了。理由见 lib/notifications.js。 */}

        {/* ── 通讯录，就摊在这一页上 ──
            原来它收在右边一个抽屉里，理由是「88 人 23 机构摆出来，每天开这一页
            都得先滚过一遍才看得到今天的活」。2026-08-21 该动的和在等的整个并进
            了 🔔 之后，这一页**再没有别的活**要被埋 —— 那条理由自己作废了，
            剩下的只有「想看名片还得先点一下」。抽屉和工具条上那颗「通讯录」
            一起撤了：同一份东西留两个入口，你每次都得先想按哪个。 */}
        <div className="pfind">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
               stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="6" cy="6" r="4.4" /><path d="M9.3 9.3 13 13" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="找谁？名字、机构、邮箱" autoComplete="off" />
          <span className="pcount">{contacts.length} 人 · {orgs.length} 机构</span>
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

        {/* 空页可以，骗人不行 —— 说清是「库里真没有」还是「没连上」。 */}
        {!contacts.length && (
          <p className="pnone">
            {fellBack === 'no-config' ? '没连上数据库（.env.local 里的 VITE_SUPABASE_* 没填）。'
             : fellBack === 'query-failed' ? '连上了但查询报错——名片读不出来，不是库里没人。'
             : '库里一个人都没有。粘个邮箱到上面那个框，我去信箱里查他是谁。'}
          </p>
        )}

      </div>
    </div>
  )
}
