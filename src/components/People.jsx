import { md, day } from '../lib/when.js'
import React, { useEffect, useMemo, useState } from 'react'
import Strangers from './Strangers.jsx'
import Veil from './Veil.jsx'
import { goldLine } from '../lib/stateText.js'
import { key as qKey } from '../lib/queue.js'

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
  contacts = [], orgs = [], strangers = [], onOpen, onOpenOrg, onAdded, fellBack = null,
  // 「新联系人」那一格开没开，在 App 手里（按钮在这一页头一行，跟看板同一个道理）
  addOpen = false, onCloseAdd,
  picking = false, picked, onPick,
  // 桌上有哪些（key 的集合）：名片角上挂「在工作区」
  desk = new Set(),
  audit = false, states = null,
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
  // 「全部 / 人 / 机构」那组镜头 2026-09-02 撤了——不用。搜什么就看什么。
  const shown = found || entries


  /** 现在挂着的机构（离开了的不在这儿显示，那是名片里的事）。 */
  const nowOrg = (c) => {
    const cur = (c.orgs || []).find((o) => !o.until)
    return cur ? [cur.org, cur.role].filter(Boolean).join(' · ')
      : ((c.orgs || []).length ? '（现在没挂机构）' : [c.org, c.role].filter(Boolean).join(' · '))
  }

  // ── 一张名片 ──
  // 原来这儿是一行密行（名字 · 机构 · 渠道 · 日期）。改成卡片是为了装得下
  // **关系**那一句：库里 95 个人每一个都有 notes，写的正是「他是谁、你们
  // 之间是什么」（「CalArts Reef 驻地的行政对接，押金和 stipend 都走她这儿」）。
  // 密行里没有它的位置，而那句话恰恰是你隔三个月回来时唯一想知道的。
  //
  // 长相直接借看板那张 .pcard：同一种东西该长得一样，气泡、勾选框、
  // 悬停抬一下，三样都是白拿的。
  const Card = ({ e }) => {
    const isOrg = e.kind === 'org'
    const id = isOrg ? null : e.c.id
    const k = id ? qKey('contact', id) : null
    const checked = k ? Boolean(picked?.has(k)) : false
    const st = id && states ? states.get(id) : null
    // 机构还不能进批量（一摞里走的是 contact / pursuit 两种键），
    // 所以勾选态下它不摆勾选框也不接点击 —— 摆一个按不动的框比不摆更糟。
    const 能勾 = picking && Boolean(k)
    // 事件往上传：⌘/Ctrl+点要开新标签，那是浏览器的规矩，得让 App 知道你按没按
    const open = (ev) => (能勾 ? onPick([k], !checked)
      : isOrg ? onOpenOrg?.(e.o, ev) : onOpen?.(e.c, ev))

    return (
      <div
        className={'pcard ppl-card' + (能勾 ? ' pickable' : '') + (能勾 && checked ? ' on' : '')
                   + (picking && !能勾 ? ' idle' : '')}
        role={能勾 ? 'checkbox' : 'button'}
        aria-checked={能勾 ? checked : undefined}
        tabIndex={0}
        onClick={open}
        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(ev) } }}
      >
        {/* 气泡：这个人现在卡在什么上。跟看板上那张卡同一套（同一份 v_pa_state）。 */}
        {audit && st && (
          <div className={'pc-bubble' + (st.zone === 'due' ? ' due' : '')}>{goldLine(st)}</div>
        )}
        {能勾 && <span className="pc-check" aria-hidden="true" />}

        <div className="pc-t">
          <Veil>{isOrg ? e.o.org : (e.c.name || '未具名联系人')}</Veil>
          {isOrg && <span className="pchip org">机构</span>}
          {/* 名片角上的记号：这张今天挑了。跟看板上那张卡同一套。 */}
          {desk.has(isOrg ? qKey('org', e.o.org) : k) && <span className="pc-desk" aria-label="在工作区">在工作区</span>}
        </div>

        <div className="pc-p ghost">
          <Veil>
            {isOrg
              ? (e.o.mailboxes?.[0]?.email || '没有共享信箱')
              : (nowOrg(e.c) || '（没挂机构）')}
          </Veil>
        </div>

        {/* 关系 —— 这一句才是名片的正文 */}
        {!isOrg && e.c.notes && <div className="ppl-rel">{e.c.notes}</div>}

        <div className="pc-m">
          {isOrg ? (
            <>
              <span className="pchip">{e.o.people_now} 人{e.o.people_past ? ` · 走了 ${e.o.people_past}` : ''}</span>
              {e.o.mail_count > 0 && <span className="pchip">{e.o.mail_count} 封</span>}
            </>
          ) : (
            <>
              {channelsOf(e.c).map((x, i) => <span key={i} className="pchip">{CH[x.kind] || x.kind}</span>)}
              {e.c.pursuits?.length > 0 && <span className="pchip">{e.c.pursuits.length} 条线</span>}
            </>
          )}
          <span className="sp" />
          <span className="prow-w">{(isOrg ? e.o.last_touch_at : e.c.last_touch_at) ? md(isOrg ? e.o.last_touch_at : e.c.last_touch_at) : '—'}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-inner ppl-inner">
        {/* 标题和那段说明撤了（2026-08-24 他拍的）：带子上已经写着「通讯录」，
            页面再写一遍「人际管理」是同一件事说两次；那段说明讲的是
            「该动的都在 🔔 里」——那是一次性的交代，不是每天都要读的东西。
            这一页现在开门见山：搜索框，然后是人。 */}

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

        {/* 加人收进带子上那颗「新联系人」后面。它是**偶尔一次**的动作
            （粘个邮箱、让它去读信、你点头），而这一页九成时间是在查人；
            常驻在页面顶上，等于每天替一件偶尔的事付一段版面。 */}
        {addOpen && (
          <section className="ppl-add">
            <div className="psect-h">
              <h2>新联系人</h2>
              <span className="sp" />
              <button className="lnk" onClick={() => onCloseAdd?.()}>收起</button>
            </div>
            <Strangers rows={strangers} contacts={contacts} onDone={onAdded} />
          </section>
        )}

        {found && (
          <div className="psect-h">
            <h2>找到的</h2><span className="pcount">{shown.length} 个</span>
          </div>
        )}

        {shown.length ? (
          <div className={'ppl-cards' + (audit ? ' audit' : '')}>
            {shown.map((e) => <Card key={e.kind + e.id} e={e} />)}
          </div>
        ) : found ? (
          <p className="pnone">没有叫这个的。上面「新联系人」里粘他的邮箱加进来。</p>
        ) : null}

        {/* 空页可以，骗人不行 —— 说清是「库里真没有」还是「没连上」。 */}
        {!contacts.length && (
          <p className="pnone">
            {fellBack === 'no-config' ? '没连上数据库（.env.local 里的 VITE_SUPABASE_* 没填）。'
             : fellBack === 'query-failed' ? '连上了但查询报错——名片读不出来，不是库里没人。'
             : '库里一个人都没有。右上角「新联系人」，粘个邮箱，我去信箱里查他是谁。'}
          </p>
        )}

      </div>
    </div>
  )
}
