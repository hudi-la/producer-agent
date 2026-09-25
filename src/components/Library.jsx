import React, { useEffect, useRef, useState } from 'react'
import { t } from '../i18n/index.js'
import { KINDS, subInfo, CREDIT_ORDER, CREDIT_LABEL, CREDIT_GROUPS, EDITABLE } from '../data/schema.js'
import Identity from './Identity.jsx'
import { EditRow, InlineText } from './EditRow.jsx'
import { useGrow } from '../lib/useGrow.js'
import { useProfile } from '../lib/profile.js'
import { saveEntry, patchFor, canEdit } from '../lib/entries.js'
import { addEntry, setEntryDraft, setEntryBox, setEntryBoxJson } from '../lib/studio.js'
import { supa } from '../lib/backends.js'
import { DB_MODE } from '../lib/backends.js'
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

// 盒子里的文本格。files 那一格是文件清单,另画(见 BoxFiles)
const boxEntries = (box) => Object.entries(box || {}).filter(([k, v]) => k !== 'files' && v != null && v !== '')
const BOX_HINTS = ['为什么是现在', '想触达', '隐线', '材料', '备注']

/**
 * 盒子里补一条。名字 + 内容两格,都填了才给存。名字是自由文本,BOX_HINTS 只是提示
 * (作者分支 2026-09-18 的做法,搬过来;库函数 pa_set_entry_box 同一支)。
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
    try { await onAdd(k.trim(), v.trim()); close() } catch (e) { setErr(e.message) }
    setSaving(false)
  }
  if (!on) return <button type="button" className="add" onClick={() => setOn(true)}>{t('+ 补一条')}</button>
  return (
    <div className="boxadd">
      <input className="idin boxadd-k" value={k} autoFocus placeholder={t('叫什么（为什么是现在 / 隐线 / …）')} list="box-hints"
             onChange={(e) => setK(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') close() }} />
      <datalist id="box-hints">{BOX_HINTS.map((h) => <option value={t(h)} key={h} />)}</datalist>
      <textarea ref={ta} className="idin" rows={2} value={v} placeholder={t('写什么')} onChange={(e) => setV(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close() } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit() } }} />
      <div className="ed-act">
        <button type="button" className="ed-ok" onMouseDown={(ev) => ev.preventDefault()} onClick={commit} disabled={saving || !k.trim() || !v.trim()}>{saving ? t('存……') : t('确定')}</button>
        <button type="button" className="ed-no" onMouseDown={(ev) => ev.preventDefault()} onClick={close} disabled={saving}>{t('取消')}</button>
        {err && <span className="ed-err">{t('没存上：')}{err}</span>}
      </div>
    </div>
  )
}

/**
 * 盒子里的文件:高清图、旧申请稿、PDF……本体进 storage(本机模式 = <数据目录>/files/box/<条目id>/),
 * 清单记在 box.files。Fairwind 拼档案时看得到文件名(不读内容)。
 */
const BOX_BUCKET = 'pursuit-files'
function BoxFiles({ entry, onSaved }) {
  const files = Array.isArray(entry.box?.files) ? entry.box.files : []
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const inp = useRef(null)
  const add = async (list) => {
    if (!list?.length) return
    setBusy(true); setErr(null)
    try {
      const next = [...files]
      for (const f of list) {
        const key = `box/${entry.id}/${Date.now()}-${f.name.replace(/[^\w.\-\u4e00-\u9fff]+/g, '_')}`
        const r = await supa.storage.from(BOX_BUCKET).upload(key, f, { contentType: f.type || 'application/octet-stream' })
        if (r.error) throw new Error(r.error.message || String(r.error))
        next.push({ name: f.name, key, size: f.size, type: f.type || '', at: new Date().toISOString() })
      }
      await setEntryBoxJson(entry.id, 'files', next)
      await onSaved?.()
    } catch (e) { setErr(e.message) }
    setBusy(false); if (inp.current) inp.current.value = ''
  }
  const remove = async (f) => {
    if (!confirm(t('删掉「{name}」？文件本体一起删。', { name: f.name }))) return
    setBusy(true); setErr(null)
    try {
      await supa.storage.from(BOX_BUCKET).remove([f.key]).catch(() => {})
      const next = files.filter((x) => x.key !== f.key)
      await setEntryBoxJson(entry.id, 'files', next.length ? next : null)
      await onSaved?.()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  return (
    <div className="boxfiles">
      {files.map((f) => (
        <div className="field boxfile" key={f.key}>
          <FileLink f={f} />
          <small>{f.size ? (f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB') : ''}</small>
          <button type="button" className="ed-no" disabled={busy} onClick={() => remove(f)} title={t('删掉这个文件')}>×</button>
        </div>
      ))}
      <label className={'add boxfile-add' + (busy ? ' busy' : '')}>
        <input ref={inp} type="file" multiple hidden disabled={busy} onChange={(ev) => add([...ev.target.files])} />
        {busy ? t('传……') : t('+ 丢进材料（文件）')}
      </label>
      <small className="bx-hint">{t('高清图、旧申请稿、PDF……存在你这台机器上。Fairwind 看得到文件名，不读内容。')}</small>
      {err && <span className="ed-err">{t('没存上：')}{err}</span>}
    </div>
  )
}
function FileLink({ f }) {
  const [url, setUrl] = useState(null)
  useEffect(() => { let on = true; supa.storage.from(BOX_BUCKET).createSignedUrl(f.key, 3600).then((r) => { if (on && r?.data?.signedUrl) setUrl(r.data.signedUrl) }).catch(() => {}); return () => { on = false } }, [f.key])
  return url ? <a className="v" href={url} target="_blank" rel="noreferrer">{f.name}</a> : <span className="v">{f.name}</span>
}

// 盒子里能补的那几样。写在这儿是**提示**不是限制：库里现有的键五花八门
// （guardrail、two_lists、proven_first_email……都是他自己起的名），
// 写死一份清单就等于把那些键判成非法。所以只做候选，想叫什么都行。

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
  const saveBox = async (k, v) => { await setEntryBox(e.id, k, v); await onSaved?.() }

  return (
    <div className={'work' + (active ? ' active' : '')}>
      {/* 这一行以前整个是一个 <button>。改成 div 是因为标题和描述现在要能就地双击编辑——
          输入框套在按钮里既是无效 HTML，点一下还会把整条折起来。
          点空白处仍然展开/收起；键盘走右边那个真按钮（展开 / 收起）。 */}
      <div className="work-hd" onClick={toggle}>
        {imgs.length > 0 && <img className="w-thumb" src={imgs[0]} alt="" loading="lazy" />}
        <div className="work-main">
          {/* 库里新建的默认标题是中文「（未命名）」(pa_add_entry);英文界面上按语言显示,存回去还是你打的字 */}
          <InlineText value={e.title === '（未命名）' ? t('（未命名）') : e.title} cls="w-t" ro={ro} onSave={(v) => save({ title: v })} />
          <InlineText value={e.body} cls="w-d" long ro={ro}
                      placeholder={open ? t('双击写点描述') : null}
                      onSave={(v) => save({ body: v })} />
          <div className="w-foot">
            <span className={'boxchip' + ((entries.length + (e.box?.files?.length || 0)) ? ' filled' : '')}>
              {(entries.length + (e.box?.files?.length || 0)) ? t('盒子 · 已补 {n} 条', { n: entries.length + (e.box?.files?.length || 0) }) : t('盒子 · 空')}
            </span>
            {/* 只有「在写」才挂标。写完的是常态，61 条各顶一个「写完了」全是噪音。
                要把一条标成在写，在展开后那块里切（见下面 EntryFields 上面那一行）。 */}
            {e.draft && (
              <button className="draftchip on" onClick={flipDraft} disabled={ro}
                      title={t('写申请时翻不到这条。点一下算写完')}>{t('在写 · 写申请时不用')}</button>
            )}
            {facts.map((f, i) => <span className="w-medium" key={i}>{f}</span>)}
            {e.source === 'website' && <span className="src-tag">{t('读自网站')}</span>}
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
                title={open ? t('收起字段、盒子和右边的对话（改好的字早存下了，这儿不管存）')
                            : t('展开这一条：字段、盒子，右边开这一条的对话。里面的字都是双击改')}
                onClick={(ev) => { ev.stopPropagation(); toggle() }}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
               strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {open
              ? <path d="m18 15-6-6-6 6" />
              : <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" /></>}
          </svg>
          {open ? t('收起') : t('展开')}
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
          {entries.length === 0 && !(e.box?.files?.length) && <div className="bx-empty">{t('还没补东西。为什么是现在 / 想触达谁 / 隐线 / 高清图、旧申请稿……都往这丢。')}</div>}
          {/* 盒子里每一条都能改(双击);底下能补一条、能丢文件。以前这儿是纯文字 + 一行死的「+ 补一条 / 丢进材料」 */}
          {entries.map(([k, v]) => (
            <EditRow key={k} label={BOX_LABELS[k] || k} long ro={ro} value={String(v)} onSave={(nv) => saveBox(k, nv)} />
          ))}
          {!ro && <BoxAdd onAdd={saveBox} />}
          {!ro && <BoxFiles entry={e} onSaved={onSaved} />}
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
  // 在写的那几条 Fairwind 写申请时不用。一次导进来十几条全是在写的话,一条条点太烦——
  // 栏头给一颗「全部标成写完」。规则本身不变(见 brain/prompt.js entriesBlock),只是让人看得见、能一下过。
  const drafts = items.filter((e) => e.draft)
  const [flipping, setFlipping] = useState(false)
  const finishAll = async () => {
    if (!confirm(t('把这栏 {n} 条都标成写完？之后 Fairwind 写申请时就会用它们。', { n: drafts.length }))) return
    setFlipping(true)
    try { for (const e of drafts) await setEntryDraft(e.id, false); await onSaved?.() } finally { setFlipping(false) }
  }
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
      {drafts.length > 0 && (
        <div className="kind-drafts">
          <span>{t('{n} 条在写：Fairwind 写申请时不用它们。看过没问题就点「写完了」。', { n: drafts.length })}</span>
          {drafts.length > 1 && <button type="button" className="kind-add" disabled={flipping} onClick={finishAll}>{flipping ? t('标着…') : t('全部标成写完')}</button>}
        </div>
      )}
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

/**
 * 左栏最底下那个「+ 加一栏」。空库只有「关于你」一格,以前连第一条作品都没处加
 * (栏是跟着条目长出来的,一条都没有的栏不画)。这里列出出厂几类里还没有的,
 * 再给一个「自己起个名」——结构是你的,类目不定死。点了 = 建这一类的第一条,
 * 栏就长出来,新那条自动展开。
 */
function AddRail({ have, onPick }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const choices = []
  for (const k of KINDS) {
    if (k.key === 'credit') { for (const g of CREDIT_GROUPS) if (!have.has(`credit:${g.key}`)) choices.push({ label: t(g.label), kind: 'credit', metaType: g.types[0], key: `credit:${g.key}` }) }
    else if (!have.has(k.key)) choices.push({ label: t(k.label), kind: k.key, key: k.key })
  }
  const go = async (c) => { if (busy) return; setBusy(true); try { await onPick(c) ; setOpen(false); setName('') } finally { setBusy(false) } }
  const custom = () => { const n = name.trim(); if (!n) return; go({ kind: n, key: n }) }
  return (
    <div className="rail-add">
      <button type="button" className={'rail-b rail-plus' + (open ? ' on' : '')} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{t('+ 加一栏')}</button>
      {open && (
        <div className="rail-menu">
          {choices.map((c) => <button type="button" key={c.key} className="rail-b" disabled={busy} onClick={() => go(c)}>{c.label}</button>)}
          <form className="rail-custom" onSubmit={(e) => { e.preventDefault(); custom() }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('自己起个名，比如「驻地日志」')} aria-label={t('新类目的名字')} />
            <button type="submit" className="kind-add" disabled={busy || !name.trim()}>{t('建')}</button>
          </form>
          <small className="rail-hint">{t('类目不定死：你维护什么就有什么栏。一条都没有的栏不显示。')}</small>
        </div>
      )}
    </div>
  )
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

  // 加一栏 = 建这一类的第一条。栏是跟着条目长的,建完刷新它就出现了。
  const addKind = async ({ kind, key, metaType }) => {
    const id = await addEntry(kind, null)
    if (metaType) await saveEntry({ id, meta: { type: metaType } })
    setPick(key)
    setOpenIds((cur_) => new Set(cur_).add(id))
    setActiveId(id)
    await onEntrySaved?.()
  }

  // 左栏那一格上「N 条在写」。这一条不能省：在写的东西 Fairwind 写申请时
  // 翻不到，而你写完忘了点标的话，收不到任何提示。这个数字就是那个提示。
  const draftsIn = (s) => (s.items || []).filter((e) => e.draft).length

  return (
    <div className="page">
      <div className={'page-inner widest' + (active ? ' drawered' : '')}>
        <header className="page-head">
          <h1>{t('我的档案')}</h1>
          {DB_MODE === 'local'
            ? <p className="note">{t('Fairwind 懂你的一切，都收在这里 · {n} 条。左边「+ 加一栏」一条条补；或者让你的 AI 工具从你的网站读进来（设置 → 接给你的 AI 工具）。每条下面的', { n: entries.length })}<span className="bx">{t('盒子')}</span>{t('，放"网站装不下"的私密外联层。')}</p>
            : <p className="note">{t('Fairwind 懂你的一切，都收在这里 · {n} 条。作品读自 ', { n: entries.length })}<b>{(profile?.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || t('你的作品站')}</b>{t('；工作、教育、战绩、自述一条条补进来。每条下面的')}<span className="bx">{t('盒子')}</span>{t('，放"网站装不下"的私密外联层。')}</p>}
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
            <AddRail have={new Set(sections.map((x) => x.key))} onPick={addKind} />
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
