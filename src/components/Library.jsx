import React, { useEffect, useState } from 'react'
import { t } from '../i18n/index.js'
import { KINDS, subInfo, CREDIT_ORDER, CREDIT_LABEL, CREDIT_GROUPS, EDITABLE } from '../data/schema.js'
import Identity from './Identity.jsx'
import { EditRow, InlineText } from './EditRow.jsx'
import { useProfile } from '../lib/profile.js'
import { saveEntry, patchFor, canEdit } from '../lib/entries.js'
import { addEntry, setEntryDraft } from '../lib/studio.js'
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
const BOX_LABELS = { why_now: t('为什么是现在'), reach_out: t('想触达'), hidden_links: t('隐线'), materials: t('材料'), note: t('备注') }

const boxEntries = (box) => Object.entries(box || {}).filter(([, v]) => v != null && v !== '')

/**
 * 展开后那块「这条的字段」—— 这一类特有的那几条事实（媒介 / 机构 / 年份 / 地点）。
 *
 * 标题和描述**不在这儿**：它们就地改（见 Entry 里的 InlineText）。
 * 上一版把它俩也放进这块，于是看的是上面那行、改的是下面这块，得对着两处看。
 */
function EntryFields({ e, ro, save }) {
  // 已知类目有自己的标签和顺序;meta 里多出来的键(AI 工具或别的类目写进来的)按键名原样显示——
  // 每个人的结构不一样,写了什么就看得见什么(2026-09-24)
  const known = EDITABLE[e.kind] || []
  const extra = Object.keys(e.meta || {}).filter((k) => !known.some((f) => f.key === k) && !(e.kind === 'credit' && k === 'type') && !(e.kind === 'work' && k === 'concern'))
  const fields = [...known, ...extra.map((k) => ({ key: k, label: k, extra: true }))]
  if (!fields.length && !ro) return null
  return (
    <div className="efields">
      <div className="bx-h">{t('这条的字段')}</div>
      {ro && (
        <div className="bx-empty">
          {t('现在看到的是示范数据（没连上库），改不了。连上 Supabase 之后这些字段就能直接改。')}
        </div>
      )}
      {fields.map((f) => (
        <EditRow key={f.key} label={t(f.label)} hint={f.hint && t(f.hint)} ro={ro}
                 value={f.col ? e[f.key] : e.meta?.[f.key]}
                 onSave={(v) => save(f.extra ? { meta: { [f.key]: v } } : patchFor(e.kind, f.key, v))} />
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
          点空白处仍然开/关编辑；键盘走右边那个真按钮（编辑 / 完成）。 */}
      <div className="work-hd" onClick={toggle}>
        {imgs.length > 0 && <img className="w-thumb" src={imgs[0]} alt="" loading="lazy" />}
        <div className="work-main">
          <InlineText value={e.title} cls="w-t" ro={ro} onSave={(v) => save({ title: v })} />
          <InlineText value={e.body} cls="w-d" long ro={ro}
                      placeholder={open ? t('双击写点描述') : null}
                      onSave={(v) => save({ body: v })} />
          <div className="w-foot">
            <span className={'boxchip' + (entries.length ? ' filled' : '')}>
              {entries.length ? t('盒子 · 已补 {n} 条', { n: entries.length }) : t('盒子 · 空')}
            </span>
            {/* 只有「在写」才挂标。写完的是常态，61 条各顶一个「写完了」全是噪音。
                要把一条标成在写，在展开后那块里切（见下面 EntryFields 上面那一行）。 */}
            {e.draft && (
              <button className="draftchip on" onClick={flipDraft} disabled={ro}
                      title={t('写申请时翻不到这条。点一下算写完')}>{t('在写')}</button>
            )}
            {facts.map((f, i) => <span className="w-medium" key={i}>{f}</span>)}
            {e.source === 'website' && <span className="src-tag">{t('读自网站')}</span>}
          </div>
        </div>
        {/* 以前这儿是 › / ⌄ —— 那个符号说的是「底下还有详情没展开」。可折叠着的时候
            文案本来就全摆着，打开之后多出来的是字段、盒子、和右边的对话：那是**改这一条**，
            不是看详情。所以按钮直说：编辑 / 完成。 */}
        <button type="button" className={'edtg' + (open ? ' on' : '')} aria-pressed={open}
                title={open ? t('改完了，收起字段和右边的对话') : t('改这一条：打开字段、盒子，右边开这一条的对话')}
                onClick={(ev) => { ev.stopPropagation(); toggle() }}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
               strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {open
              ? <path d="M20 6 9 17l-5-5" />
              : <><path d="M12 20h9" /><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" /></>}
          </svg>
          {open ? t('完成') : t('编辑')}
        </button>
      </div>
      {open && (
        <div className="box">
          {imgs.length > 1 && (
            <div className="w-imgs">{imgs.map((src, i) => <img src={src} alt="" key={i} loading="lazy" />)}</div>
          )}
          {!ro && (
            <div className="draftrow">
              <span>{e.draft ? t('这条还在写') : t('这条写完了')}</span>
              <button className="draftflip" onClick={flipDraft}>
                {e.draft ? t('标成写完了') : t('标成还在写')}
              </button>
              <i>{e.draft ? t('写申请时它翻不到这条') : t('写申请时它会拿这条当战绩用')}</i>
            </div>
          )}
          <EntryFields e={e} ro={ro} save={save} />
          <div className="bx-h">{t('盒子 · 网站装不下的')}</div>
          {entries.length === 0 && <div className="bx-empty">{t('还没补东西。为什么是现在 / 想触达谁 / 隐线 / 高清图、旧申请稿……都往这丢。')}</div>}
          {entries.map(([k, v]) => (
            <div className="field" key={k}><span className="k">{BOX_LABELS[k] || k} · </span><span className="v">{String(v)}</span></div>
          ))}
          <div className="add">{t('+ 补一条 / 丢进材料')}</div>
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
    : (k) => t(CREDIT_LABEL[k] || k)
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
        {onAdd && <button className="kind-add" onClick={onAdd}>{t('+ 加一条')}</button>}
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

  const secs = [{ key: 'about', label: t('关于你'), about: true }]
  const seen = new Set()

  for (const k of KINDS) {
    const items = byKind.get(k.key)
    seen.add(k.key)
    if (!items?.length) continue
    if (k.key !== 'credit') {
      secs.push({ key: k.key, label: t(k.label), kind: k.key, items, sub: k.sub })
      continue
    }
    const placed = new Set()
    for (const g of CREDIT_GROUPS) {
      const items_ = items.filter((e) => g.types.includes(e.meta?.type))
      items_.forEach((e) => placed.add(e))
      if (items_.length) secs.push({ key: `credit:${g.key}`, label: t(g.label), kind: 'credit', items: items_, sub: 'credit' })
    }
    const rest = items.filter((e) => !placed.has(e))
    if (rest.length) secs.push({ key: 'credit:rest', label: t('其他战绩'), kind: 'credit', items: rest, sub: 'credit' })
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
          <h1>{t('我的档案')}</h1>
          <p className="note">{t('Fairwind 懂你的一切，都收在这里 · {n} 条。作品读自 ', { n: entries.length })}<b>{(profile?.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || t('你的作品站')}</b>{t('；工作、教育、战绩、自述一条条补进来。每条下面的')}<span className="bx">{t('盒子')}</span>{t('，放"网站装不下"的私密外联层。')}</p>
        </header>
        <div className="lib-two">
          <nav className="lib-rail" aria-label={t('档案分类')}>
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
                  {d > 0 && <span className="rail-d" title={t('写申请时翻不到这几条')}>{t('{d} 在写', { d })}</span>}
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
        <aside className="drawer" aria-label={t('一起写《{title}》', { title: active.title || t('未命名') })}>
          <DrawerGrip />
          <EntryChat entry={active} key={active.id} onClose={() => toggle(active.id)} />
        </aside>
      )}
    </div>
  )
}
