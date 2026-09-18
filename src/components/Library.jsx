import React, { useEffect, useRef, useState } from 'react'
import { KINDS, subInfo, CREDIT_ORDER, CREDIT_LABEL, CREDIT_GROUPS, EDITABLE } from '../data/schema.js'
import Identity from './Identity.jsx'
import { EditRow, InlineText } from './EditRow.jsx'
import { useGrow } from '../lib/useGrow.js'
import { useProfile } from '../lib/profile.js'
import { saveEntry, patchFor, canEdit } from '../lib/entries.js'
import { addEntry, setEntryDraft, setEntryBox } from '../lib/studio.js'
import EntryChat from './EntryChat.jsx'
import DrawerGrip from './DrawerGrip.jsx'

// 「我的档案」——原来是右边划出来的抽屉，现在是一级页面。
// 这里是 Fairwind 判断匹配、写「为什么是我」、填申请字段的全部弹药，
// 59 条事实不该藏在一个划出来又划回去的侧栏里。
//
// 但 60 条摊成一条长滚也不对：要找「教育」得滚过 22 条展览。所以现在是左右两栏——
// 左边一列格名（关于你 / 作品 / 自述 / …），右边一次只开一格。
//
// 一次只看得见一格，是拿「一眼看全」换「找得到」。补偿是左栏每一行都带条数：
// 60 条一条没少，你始终知道它在哪、有几条。

const CONCERN_ORDER = ['intimacy', 'systems', 'body_space_time']
const BOX_LABELS = { why_now: '为什么是现在', reach_out: '想触达', hidden_links: '隐线', materials: '材料', note: '备注' }

const boxEntries = (box) => Object.entries(box || {}).filter(([, v]) => v != null && v !== '')

// 盒子里能补的那几样。写在这儿是**提示**不是限制：库里现有的键五花八门
// （guardrail、two_lists、proven_first_email……都是他自己起的名），
// 写死一份清单就等于把那些键判成非法。所以只做候选，想叫什么都行。
const BOX_HINTS = ['为什么是现在', '想触达', '隐线', '材料', '备注']

/**
 * 盒子里补一条。名字 + 内容两格，都填了才给存。
 *
 * 为什么名字是自由文本：见 BOX_HINTS 上面那段。
 */
function BoxAdd({ onAdd }) {
  const [on, setOn] = useState(false)
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const ta = useRef(null)
  useGrow(ta, v, on)

  const close = () => { setOn(false); setK(''); setV(''); setErr(null) }
  const commit = async () => {
    if (!k.trim() || !v.trim()) return
    setSaving(true); setErr(null)
    try { await onAdd(k.trim(), v.trim()); close() }
    catch (e) { setErr(e.message) }        // 存不上就留在框里，你打的字还在
    setSaving(false)
  }

  if (!on) return <button className="add" onClick={() => setOn(true)}>+ 补一条</button>

  return (
    <div className="boxadd">
      <input className="idin boxadd-k" value={k} autoFocus placeholder="叫什么（为什么是现在 / 隐线 / …）"
             list="box-hints" onChange={(e) => setK(e.target.value)}
             onKeyDown={(e) => { if (e.key === 'Escape') close() }} />
      <datalist id="box-hints">{BOX_HINTS.map((h) => <option value={h} key={h} />)}</datalist>
      <textarea ref={ta} className="idin" rows={2} value={v} placeholder="写什么"
                onChange={(e) => setV(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); close() }
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit() }
                }} />
      <div className="ed-act">
        <button className="ed-ok" onMouseDown={(ev) => ev.preventDefault()} onClick={commit}
                disabled={saving || !k.trim() || !v.trim()}>{saving ? '存……' : '确定'}</button>
        <button className="ed-no" onMouseDown={(ev) => ev.preventDefault()} onClick={close} disabled={saving}>取消</button>
        {err && <span className="ed-err">没存上：{err}</span>}
      </div>
    </div>
  )
}

/**
 * 展开后那块「这条的字段」—— 这一类特有的那几条事实（媒介 / 机构 / 年份 / 地点）。
 *
 * 标题和描述**不在这儿**：它们就地改（见 Entry 里的 InlineText）。
 * 上一版把它俩也放进这块，于是看的是上面那行、改的是下面这块，得对着两处看。
 */
function EntryFields({ e, ro, save }) {
  const fields = EDITABLE[e.kind] || []
  if (!fields.length && !ro) return null
  return (
    <div className="efields">
      <div className="bx-h">这条的字段</div>
      {ro && (
        <div className="bx-empty">
          现在看到的是示范数据（没连上库），改不了。连上 Supabase 之后这些字段就能直接改。
        </div>
      )}
      {fields.map((f) => (
        <EditRow key={f.key} label={f.label} hint={f.hint} ro={ro}
                 value={f.col ? e[f.key] : e.meta?.[f.key]}
                 onSave={(v) => save(patchFor(e.kind, f.key, v))} />
      ))}
    </div>
  )
}

// 展开状态住在 Library 里，不住在这儿 —— 「加一条」建完要把新那条自动展开，
// 而那个动作发生在 Library。行为一个字没变：还是点空白展开、点 › 展开，
// 还是可以同时开好几条。
function Entry({ e, open, active, onToggle, onSaved }) {
  const entries = boxEntries(e.box)
  const facts = subInfo(e)
  const imgs = e.images || []
  const ro = !canEdit(e)
  const save = async (patch) => { await saveEntry({ id: e.id, ...patch }); await onSaved?.() }
  const saveBox = async (k, v) => { await setEntryBox(e.id, k, v); await onSaved?.() }
  const toggle = () => onToggle(e.id)
  // 「在写」：外面写申请时翻不到这条，档案页和书桌上照常看得见。
  // 点一下就切——这是他自己的判断，不该有第二道确认。
  const flipDraft = async (ev) => {
    ev.stopPropagation()
    if (ro) return
    await setEntryDraft(e.id, !e.draft)
    await onSaved?.()
  }

  return (
    <div className={'work' + (active ? ' active' : '')}>
      {/* 这一行以前整个是一个 <button>。改成 div 是因为标题和描述现在要能就地双击编辑——
          输入框套在按钮里既是无效 HTML，点一下还会把整条折起来。
          点空白处仍然展开/收起；键盘走右边那个真按钮（展开 / 收起）。 */}
      <div className="work-hd" onClick={toggle}>
        {imgs.length > 0 && <img className="w-thumb" src={imgs[0]} alt="" loading="lazy" />}
        <div className="work-main">
          <InlineText value={e.title} cls="w-t" ro={ro} onSave={(v) => save({ title: v })} />
          <InlineText value={e.body} cls="w-d" long ro={ro}
                      placeholder={open ? '双击这儿写描述' : null}
                      onSave={(v) => save({ body: v })} />
          <div className="w-foot">
            <span className={'boxchip' + (entries.length ? ' filled' : '')}>
              {entries.length ? `盒子 · 已补 ${entries.length} 条` : '盒子 · 空'}
            </span>
            {/* 只有「在写」才挂标。写完的是常态，61 条各顶一个「写完了」全是噪音。
                要把一条标成在写，在展开后那块里切（见下面 EntryFields 上面那一行）。 */}
            {e.draft && (
              <button className="draftchip on" onClick={flipDraft} disabled={ro}
                      title="写申请时翻不到这条。点一下算写完">在写</button>
            )}
            {facts.map((f, i) => <span className="w-medium" key={i}>{f}</span>)}
            {e.source === 'website' && <span className="src-tag">读自网站</span>}
          </div>
        </div>
        {/* 这颗按钮**不管改字**。改字是双击那一段（InlineText），折叠着也能改，
            改完那一格自己有「确定 / 取消」—— 两套东西，各管各的。
            它管的是「把这一条摊开来干活」：在写/写完的开关、字段、盒子，
            外加右边那条对话。
            名字换过三回：› （光一个箭头，说的是「底下还有详情」）、「编辑」
            （那是双击在干的事，屏幕上于是有两个「编辑」各管一半）、「一起写」
            （把右边那条对话说成了主角，可它主要就是展开）。现在就叫展开，
            但写成字不留一个光箭头——箭头不说它展开的是什么。 */}
        <button type="button" className={'edtg' + (open ? ' on' : '')} aria-pressed={open}
                title={open ? '收起字段、盒子和右边的对话（改好的字早存下了，这儿不管存）'
                            : '展开这一条：字段、盒子，右边开这一条的对话。里面的字都是双击改'}
                onClick={(ev) => { ev.stopPropagation(); toggle() }}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
               strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {open
              ? <path d="m18 15-6-6-6 6" />
              : <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" /></>}
          </svg>
          {open ? '收起' : '展开'}
        </button>
      </div>
      {open && (
        <div className="box">
          {imgs.length > 1 && (
            <div className="w-imgs">{imgs.map((src, i) => <img src={src} alt="" key={i} loading="lazy" />)}</div>
          )}
          {!ro && (
            <div className="draftrow">
              <span>{e.draft ? '这条还在写' : '这条写完了'}</span>
              <button className="draftflip" onClick={flipDraft}>
                {e.draft ? '标成写完了' : '标成还在写'}
              </button>
              <i>{e.draft ? '写申请时它翻不到这条' : '写申请时它会拿这条当战绩用'}</i>
            </div>
          )}
          <EntryFields e={e} ro={ro} save={save} />
          <div className="bx-h">盒子 · 网站装不下的</div>
          {entries.length === 0 && <div className="bx-empty">还没补东西。为什么是现在 / 想触达谁 / 隐线 / 验证过的开场……都往这丢。</div>}
          {/* 盒子里的每一条现在也能改了。在这之前它们是摆着的纯文字，
              而库里连一支写盒子的入口都没有 —— 只能开 SQL。 */}
          {entries.map(([k, v]) => (
            <EditRow key={k} label={BOX_LABELS[k] || k} long ro={ro} value={String(v)}
                     onSave={(nv) => saveBox(k, nv)} />
          ))}
          {!ro && <BoxAdd onAdd={saveBox} />}
        </div>
      )}
    </div>
  )
}

// Build ordered [subLabel, items[]] groups for a sub-grouped section.
function subGroups(items, sub, concerns) {
  const keyOf = sub === 'concern' ? (e) => e.concern : (e) => e.meta?.type
  const order = sub === 'concern' ? CONCERN_ORDER : CREDIT_ORDER
  const labelOf = sub === 'concern'
    ? (k) => concerns?.[k] || k
    : (k) => CREDIT_LABEL[k] || k
  const groups = []
  const seen = new Set()
  for (const k of order) {
    const g = items.filter((e) => keyOf(e) === k)
    if (g.length) { groups.push([labelOf(k), g]); seen.add(k) }
  }
  for (const e of items) {
    const k = keyOf(e)
    if (!seen.has(k)) { seen.add(k); groups.push([labelOf(k), items.filter((x) => keyOf(x) === k)]) }
  }
  return groups
}

function KindSection({ label, items, sub, concerns, onSaved, openIds, activeId, onToggle, onAdd }) {
  // 只有一个子组时不写子标题——「策展」那一格底下再顶一行「策展项目」是重复的。
  const groups = sub ? subGroups(items, sub, concerns) : null
  const one = (e) => (
    <Entry e={e} key={e.id || e.title + e.sort}
           open={openIds.has(e.id)} active={e.id === activeId}
           onToggle={onToggle} onSaved={onSaved} />
  )
  return (
    <section className="kind">
      <div className="kind-h">
        {label} · {items.length}
        {/* 在这之前档案页**没有任何一个「加一条」的入口**：pa_set_entry 只能改
            已有的那条，Library 里那行「+ 补一条」是一段死文字。想往「工作坊」
            那栏放一份新 proposal，只有开 SQL 一条路。 */}
        {onAdd && <button className="kind-add" onClick={onAdd}>+ 加一条</button>}
      </div>
      {groups ? (
        groups.map(([subLabel, g]) => (
          <div className="concern" key={subLabel}>
            {groups.length > 1 && <div className="cn-h">{subLabel}</div>}
            <div className="works">{g.map(one)}</div>
          </div>
        ))
      ) : (
        <div className="works">{items.map(one)}</div>
      )}
    </section>
  )
}

/**
 * 左栏那一列格。第一格永远是「关于你」（它不是条目，是 profile）。
 *
 * 兜底有两处，都是为了「不许有条目在页面上没有家」：
 *   · credit 里类型不在 CREDIT_GROUPS 的 → 归「其他战绩」
 *   · kind 不在 KINDS 里的（以后新加的 kind）→ 自己占一格，标题就是那个 kind
 */
function buildSections(entries) {
  const byKind = new Map()
  for (const e of entries) {
    if (!byKind.has(e.kind)) byKind.set(e.kind, [])
    byKind.get(e.kind).push(e)
  }

  const secs = [{ key: 'about', label: '关于你', about: true }]
  const seen = new Set()

  for (const k of KINDS) {
    const items = byKind.get(k.key)
    seen.add(k.key)
    if (!items?.length) continue
    if (k.key !== 'credit') {
      secs.push({ key: k.key, label: k.label, kind: k.key, items, sub: k.sub })
      continue
    }
    const placed = new Set()
    for (const g of CREDIT_GROUPS) {
      const items_ = items.filter((e) => g.types.includes(e.meta?.type))
      items_.forEach((e) => placed.add(e))
      if (items_.length) secs.push({ key: `credit:${g.key}`, label: g.label, kind: 'credit', items: items_, sub: 'credit' })
    }
    const rest = items.filter((e) => !placed.has(e))
    if (rest.length) secs.push({ key: 'credit:rest', label: '其他战绩', kind: 'credit', items: rest, sub: 'credit' })
  }

  for (const [kind, items] of byKind) {
    if (!seen.has(kind)) secs.push({ key: kind, label: kind, kind, items })
  }
  return secs
}

export default function Library({ entries, concerns, onProfileSaved, onEntrySaved, onDrawerChange }) {
  const profile = useProfile()
  const sections = buildSections(entries)
  const [pick, setPick] = useState('about')
  // 选中的格可能因为库变了而消失（比如某类被清空）——退回「关于你」，别渲染空白。
  const cur = sections.find((s) => s.key === pick) || sections[0]

  // 展开着哪几条，以及**右边正在聊哪一条**。
  //
  // 右边跟着你最后点开的那条走。不新造「选中」这个动作要你学：展开 = 那条
  // 摆到右边，收起 = 退回另一条还开着的（都关了就空着）。
  const [openIds, setOpenIds] = useState(new Set())
  const [activeId, setActiveId] = useState(null)
  const toggle = (id) => setOpenIds((cur_) => {
    const next = new Set(cur_)
    if (next.has(id)) {
      next.delete(id)
      // 关掉的正是右边那条：退回另一条还开着的，别把对话留在一条看不见的东西上
      setActiveId((a) => (a === id ? [...next][next.size - 1] ?? null : a))
    } else {
      next.add(id)
      setActiveId(id)
    }
    return next
  })

  // 右边摊的那一条。它可能因为库变了而消失（换了栏、被删了）——那就空着，
  // 别拿一个不存在的 id 去拉对话。
  const active = entries.find((e) => e.id === activeId && e.id) || null

  // 告诉外面抽屉开着没有：顶栏要让位（跟机会卡的抽屉同一套 .wrap.drawered）。
  // 离开这一页时关掉 —— 不然去了看板，顶栏还让着一个不存在的抽屉。
  useEffect(() => { onDrawerChange?.(!!active) }, [active, onDrawerChange])
  useEffect(() => () => onDrawerChange?.(false), [onDrawerChange])

  // 加一条。新那条库里标着「在写」，建完自动展开，标题就地改。
  // 「关于你」那一格没有这个按钮 —— 它是 profile，不是条目。
  const add = cur.kind ? async () => {
    const id = await addEntry(cur.kind, null)
    setOpenIds((cur_) => new Set(cur_).add(id))
    setActiveId(id)
    await onEntrySaved?.()
  } : null

  // 左栏那一格上「N 条在写」。这一条不能省：在写的东西 Fairwind 写申请时
  // 翻不到，而你写完忘了点标的话，收不到任何提示。这个数字就是那个提示。
  const draftsIn = (s) => (s.items || []).filter((e) => e.draft).length

  return (
    <div className="page">
      <div className={'page-inner widest' + (active ? ' drawered' : '')}>
        <header className="page-head">
          <h1>我的档案</h1>
          <p className="note">Fairwind 懂你的一切，都收在这里 · {entries.length} 条。作品读自 <b>{(profile?.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || '你的作品站'}</b>；工作、教育、战绩、自述一条条补进来。每条下面的<span className="bx">盒子</span>，放"网站装不下"的私密外联层。</p>
        </header>
        <div className="lib-two">
          <nav className="lib-rail" aria-label="档案分类">
            {sections.map((s) => {
              const d = draftsIn(s)
              return (
                <button
                  key={s.key}
                  className={'rail-b' + (s.key === cur.key ? ' on' : '')}
                  onClick={() => setPick(s.key)}
                  aria-current={s.key === cur.key ? 'true' : undefined}
                >
                  <span className="rail-l">{s.label}</span>
                  {d > 0 && <span className="rail-d" title="写申请时翻不到这几条">{d} 在写</span>}
                  {s.items && <span className="rail-n">{s.items.length}</span>}
                </button>
              )
            })}
          </nav>
          <div className="lib-pane">
            {cur.about
              ? <Identity onSaved={onProfileSaved} />
              : <KindSection label={cur.label} items={cur.items} sub={cur.sub} concerns={concerns}
                             onSaved={onEntrySaved} openIds={openIds} activeId={activeId}
                             onToggle={toggle} onAdd={add} />}
          </div>
        </div>
      </div>
      {/* 右边那个抽屉 —— **跟机会卡片的是同一个**：同一个 .drawer 外壳，
          从窗口顶贴到底，左沿能拉宽，不跟着页面滚。
          平时不在：一条都没摊开时整块不渲染。摊开哪一条它才划出来，聊的就是那一条。
          页面自己往左让出抽屉那么宽，所以原文不会被盖住，左右对着看。 */}
      {active && (
        <aside className="drawer" aria-label={`一起写《${active.title || '未命名'}》`}>
          <DrawerGrip />
          <EntryChat entry={active} key={active.id} onClose={() => toggle(active.id)} />
        </aside>
      )}
    </div>
  )
}
