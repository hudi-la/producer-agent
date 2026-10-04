import ErrorNotice from './ErrorNotice.jsx'
import { errorText } from '../lib/userError.js'
// src/components/SettingsPage.jsx —— 「设置」:一张张卡片,一张管一件事。
//   装了哪些 · 语言 · 模型 · 接给你的 AI 工具 · 备份 ·(本机)这台机器
//
// 2026-10-03 重排:原来是「装了哪些」+ 一大块「账号」表单,标签列 90px、药丸和说明对不上,
// 中间一颗「保存」不知道存的是哪几样。现在拆成卡片——每张卡自己的按钮只管自己那几样:
//   语言点了当场存、整页重开;模型那张底下的「保存」只存模型来源 / key / 两档;
//   邮箱、备份目录各自一颗小「保存」。
// 账号不在这儿:线上版右上角那颗账号菜单就是它(AccountMenu.jsx),设置里再放一行是重复。
// /settings 只在这一层读一次,往下传;谁改了就叫 reload 重读。
import { useEffect, useRef, useState } from 'react'
import { t, getLang } from '../i18n/index.js'
import { DB_MODE, supa, brainApi, BRAIN } from '../lib/backends.js'
import ModulesPanel from './ModulesPanel.jsx'
import ProviderPicker, { Spin } from './ProviderPicker.jsx'

export default function SettingsPage() {
  const local = DB_MODE === 'local'
  const [cur, setCur] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [asked, setAsked] = useState(false)   // 问过 /settings 了(没答 → 得说一句,不能空着)
  const load = () => (brainApi ? brainApi.settings.get() : Promise.resolve(null))
    .then((s) => { if (!s || s.error) setLoadError(s?.error || 'Fairwind connection unavailable'); else { setCur(s); setLoadError(null) }; setAsked(true) })
    .catch((e) => { setLoadError(e); setAsked(true) })
  useEffect(() => { load() }, [])
  return (
    // 外层 .page 是各区共用的滚动层(.wrap 固定高度不滚);里层限宽
    <section className="page settings-page">
      <div className="settings-inner">
        <header className="lib-head"><h1>{t('设置')}</h1></header>
        <ModulesPanel />
        <ErrorNotice error={loadError} context={t('设置')} onRetry={load} />
        {!cur ? (!asked && <Spin />) : <>
          <LangCard lang={cur.lang || getLang() || 'zh'} />
          <ModelCard cur={cur} reload={load} />
          {local ? <LocalMcpCard /> : <HostedMcpCard token={cur.mcpToken || ''} onRotated={load} />}
          <BackupCard local={local} backupDir={cur.backupDir || ''} reload={load} />
          {local && <MachineCard email={cur.email || ''} reload={load} />}
        </>}
      </div>
    </section>
  )
}

// 一张卡:标题 + 一句说明;aside 放在标题右边(比如「怎么接 →」)
function Card({ title, desc, aside, children, className = '' }) {
  return (
    <section className={'set-card ' + className}>
      <header className="set-card-h">
        <div><h2>{title}</h2>{desc && <p>{desc}</p>}</div>
        {aside}
      </header>
      {children}
    </section>
  )
}

// Lucide 内联(24 视口 / currentColor / 1.75 圆头),跟别处一致,不用 emoji
const Icon = ({ d, children }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children || <path d={d} />}</svg>
)
const CopyIcon = () => <Icon><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></Icon>
const CheckIcon = () => <Icon d="M20 6 9 17l-5-5" />

// 命令框:等宽一行,复制钮在框里右边。复制完变一个勾 + 「已复制」,一秒半后回去
function CmdBox({ cmd }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)
  const copy = async () => { try { setError(null); await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch (e) { setError(t('复制失败，请手动选中并复制上面的命令。')) } }
  return (
    <div><div className="cmd-box">
      <code>{cmd}</code>
      <button type="button" className={'cmd-copy' + (copied ? ' done' : '')} onClick={copy} aria-label={t('复制')} title={t('复制')}>
        {copied ? <><CheckIcon /><span>{t('已复制')}</span></> : <CopyIcon />}
      </button>
    </div><ErrorNotice error={error} /></div>
  )
}

const Note = ({ msg, bad, context }) => msg ? (bad ? <ErrorNotice error={msg} context={context} /> : <span className="la-note" role="status">{msg}</span>) : null

// ── 语言 ──────────────────────────────────────────────
// 点了当场存、整页按新语言重开——之前要先点保存,提示又说"刷新生效",他刷新了当然没变
function LangCard({ lang }) {
  const [on, setOn] = useState(lang)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const pick = async (l) => {
    if (l === on || busy) return
    setOn(l); setBusy(true)
    setError(null)
    const r = await brainApi.settings.set({ lang: l })
    if (r.error) { setError(r.error); setOn(lang); setBusy(false); return }
    location.reload()
  }
  return (
    <Card title={t('语言')} desc={t('选完页面会按新语言重开')}>
      <ErrorNotice error={error} context={t('语言')} />
      <div className="fr-lang set-lang" role="radiogroup" aria-label="Language / 语言">
        <button type="button" role="radio" aria-checked={on === 'zh'} className={on === 'zh' ? 'on' : ''} onClick={() => pick('zh')}>中文</button>
        <button type="button" role="radio" aria-checked={on === 'en'} className={on === 'en' ? 'on' : ''} onClick={() => pick('en')}>English</button>
        {busy && <Spin />}
      </div>
    </Card>
  )
}

// ── 模型 ──────────────────────────────────────────────
// key **永远不回显**:brain 只给「设了没有」和末四位,输入框空着 = 不动原来的,填了 = 换掉。改完当场生效。
// 这张卡底下的「保存」只存这几样(来源、四种凭据、两档),别的卡不跟着存。
const KEYS = ['apiKey', 'oauthToken', 'openaiKey', 'geminiKey']
function ModelCard({ cur, reload }) {
  const fresh = () => ({ provider: cur.provider || 'claude-key', model: cur.model || '', modelCheap: cur.modelCheap || '', apiKey: '', oauthToken: '', openaiKey: '', geminiKey: '' })
  const [form, setForm] = useState(fresh)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState({ msg: '', bad: false })
  const inUse = cur.provider || 'claude-key'
  const dirty = KEYS.some((k) => form[k]) || form.provider !== inUse || form.model !== (cur.model || '') || form.modelCheap !== (cur.modelCheap || '')
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setNote({ msg: '', bad: false })
    const r = await brainApi.settings.set(form)
    setBusy(false)
    if (r?.error) return setNote({ msg: t('没存上:') + r.error.message, bad: true })
    setNote({ msg: t('存好了,下一次开口就用新的'), bad: false })
    setForm((f) => ({ ...f, apiKey: '', oauthToken: '', openaiKey: '', geminiKey: '' }))
    await reload()
  }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  return (
    <Card title={t('模型')} desc={t('Fairwind 用哪家的模型想事情。key 只存不回显。')}>
      <form className="set-form" onSubmit={save}>
        <ProviderPicker value={form.provider} inUse={inUse}
          onChange={(v) => setForm((f) => ({ ...f, provider: v, ...((v === 'chatgpt-subscription' || f.provider === 'chatgpt-subscription') ? { model: '', modelCheap: '' } : {}) }))}
          keys={form} onKey={set}
          hints={{ apiKey: cur.apiKeySet ? cur.apiKeyHint : '', oauthToken: cur.oauthTokenSet ? cur.oauthTokenHint : '', openaiKey: cur.openaiKeySet ? cur.openaiKeyHint : '', geminiKey: cur.geminiKeySet ? cur.geminiKeyHint : '' }} />
        <div className="set-pair">
          <Field label={t('好档模型')} hint={t('聊天、写信、讲懂用这档')} value={form.model} placeholder={t('空 = 默认')} onChange={(v) => set('model', v)} />
          <Field label={t('便宜档模型')} hint={t('判断、收信那些小活用这档')} value={form.modelCheap} placeholder={t('空 = 默认')} onChange={(v) => set('modelCheap', v)} />
        </div>
        <footer className="set-foot">
          <button type="submit" className="b primary" disabled={busy || !dirty}>{busy ? <><Spin />{t('存着…')}</> : t('保存')}</button>
          <Note {...note} context={t('模型')} />
        </footer>
      </form>
    </Card>
  )
}

// 标签在上、说明、输入框占满——跟首启页同一个次序
function Field({ label, hint, value, onChange, placeholder, type = 'text', children }) {
  return (
    <label className="set-field">
      <span className="set-k">{label}</span>
      {hint && <small>{hint}</small>}
      <span className="set-inline">
        <input type={type} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
        {children}
      </span>
    </label>
  )
}

// ── 接给你的 AI 工具 ──────────────────────────────────
const MCP_DESC = '让它能读写你的档案、机会卡、判据——比如"读我的网站，把作品填进来"。'
const GuideLink = ({ base }) => <a className="set-link" href={`${base}/mcp-guide`} target="_blank" rel="noreferrer">{t('怎么接 →')}</a>

// 本机:三颗「接入」替你改这台机器上那几个工具的配置文件;Claude Code 走终端那一行。端口按当前页面的来
function LocalMcpCard() {
  const [targets, setTargets] = useState([])     // 三个能接的桌面工具,各自接没接
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState('')
  const url = `${location.origin}/mcp`
  const cmd = `claude mcp add --transport http fairwind ${url}`
  const [loadError, setLoadError] = useState(null)
  const load = () => supa.mcpTargets.list().then((r) => { if (r.error) setLoadError(r.error); else { setTargets(r); setLoadError(null) } })
  useEffect(() => { load() }, [])
  const RESTART = { 'claude-desktop': 'Claude', codex: 'Codex', 'gemini-cli': 'Gemini CLI' }
  const install = async (target) => {
    setBusy(target)
    const r = await supa.mcpTargets.install(target)
    setBusy('')
    setMsg((m) => ({ ...m, [target]: r.ok ? t('写好了。把 {app} 完全退出再打开，对话里就有 Fairwind 的工具了', { app: RESTART[target] || t('它') }) : t('没成:') + errorText(r.error) }))
    await load()
  }
  return (
    <Card title={t('接给你的 AI 工具')} desc={t(MCP_DESC)} aside={<GuideLink base={location.origin} />}>
      <ErrorNotice error={loadError} context="MCP" onRetry={load} />
      <div className="set-rows">
        {targets.map((x) => (
          <div className="set-row" key={x.target}>
            <div className="set-row-l">
              <b>{t(x.label)}</b>
              {x.appInstalled === false && <small>{t('这台机器上没见到它')}</small>}
              {msg[x.target] && <Note msg={msg[x.target]} bad={msg[x.target].startsWith(t('没成:'))} />}
            </div>
            <button type="button" className={'b' + (x.current ? '' : ' primary')} disabled={!!busy} onClick={() => install(x.target)}>
              {busy === x.target ? <Spin /> : x.current ? <CheckIcon /> : null}
              {x.current ? t('已接入 · 再写一次') : t('接入')}
            </button>
          </div>
        ))}
        <div className="set-row set-row-stack">
          <div className="set-row-l"><b>Claude Code</b><small>{t('在终端里粘这一行，之后每次打开都带着。')}</small></div>
          <CmdBox cmd={cmd} />
        </div>
      </div>
      <small className="set-foot-note">{t('ChatGPT 聊天 app 接不上（它只认公网地址），用 ChatGPT 的人走 Codex。')}</small>
    </Card>
  )
}

// 线上:够不着你的机器,换成一行命令,带着你自己的令牌,粘进哪个工具都行。令牌漏了就「换一串」,旧的当场作废。
function HostedMcpCard({ token, onRotated }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ msg: '', bad: false })
  // 地址按脑子的来(托管下脑子直接服务页面,跟页面同源;他自己那份前端和脑子可能不在一个域)
  const b = new URL(BRAIN)
  const url = `${b.protocol}//user:${token || t('<令牌>')}@${b.host}/mcp`
  const cmd = `<Fairwind>/node mcp-bridge.cjs ${url}`
  const rotate = async () => {
    setBusy(true); setMsg({ msg: '', bad: false })
    try {
      const body = await brainApi.settings.rotateMcpToken()
      if (body.error) throw new Error(errorText(body.error))
      setMsg({ msg: t('换好了。旧的那串从现在起不认;接着的工具要重新粘一次。'), bad: false }); await onRotated?.()
    } catch (e) { setMsg({ msg: t('没换成:') + e.message, bad: true }) }
    setBusy(false)
  }
  return (
    <Card title={t('接给你的 AI 工具')} desc={t('让它能读写你的档案和机会卡——比如"读我的网站，把作品填进来"。')} aside={<GuideLink base={BRAIN} />}>
      <div className="set-stack">
        <small className="set-hint">{t('把这一行粘进 Claude 桌面版、Codex、Gemini CLI 的 MCP 配置（<Fairwind> 换成你装的位置）。')}</small>
        <CmdBox cmd={cmd} />
        <div className="set-warn">
          <span>{token ? t('这串里带着你的令牌，别给别人看。') : t('还没有令牌:点「换一串」生成一串')}</span>
          <button type="button" className="set-quiet" disabled={busy} onClick={rotate}>{busy ? <><Spin />{t('在换…')}</> : t('换一串')}</button>
        </div>
        <Note {...msg} />
      </div>
    </Card>
  )
}

// ── 备份 ──────────────────────────────────────────────
// 我的备份:一个 zip,我名下所有东西 + 附件。本机和线上同一种,哪边导出都能导进另一边——
// 公司撤了、换电脑、从本机搬上线,都是这两颗(设计稿 2026-10-02 D16)。本机再多一份「机器备份」。
function BackupCard({ local, backupDir, reload }) {
  return (
    <Card title={t('备份')} desc={local ? t('两种:能带去线上版的 zip,和整台机器的数据目录。') : t('一个 zip:我名下的全部 + 附件。本机版和线上版通用')}>
      <MyBackup showDesc={local} />
      {local && <MachineBackup backupDir={backupDir} reload={reload} />}
    </Card>
  )
}

function MyBackup({ showDesc }) {
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const api = brainApi
  const download = async () => {
    if (!api) return
    setBusy('export'); setMsg(''); setError(null)
    try {
      const blob = await api.backup.export()
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fairwind-${new Date().toISOString().slice(0, 10)}.zip`; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
      setMsg(t('下好了:{mb} MB', { mb: (blob.size / 1048576).toFixed(1) }))
    } catch (e) { setError(e) }
    setBusy('')
  }
  const restore = async (file) => {
    if (!file || !api) return
    if (!confirm(t('用这份备份换掉现在的全部?现在库里我名下的行会先清掉,再导进这份。附件同名的覆盖。'))) { fileRef.current.value = ''; return }
    setBusy('import'); setMsg(''); setError(null)
    const r = await api.backup.import(file, { wipe: true })
    setBusy(''); fileRef.current.value = ''
    if (!r.ok) { setError(r.error); return }
    const rows = Object.values(r.tables || {}).reduce((a, b) => a + b, 0)
    setMsg(t('导好了:{rows} 行、{files} 个文件{failed}', { rows, files: r.files, failed: r.failed?.length ? t(';{n} 个文件没传上', { n: r.failed.length }) : '' }))
    if (r.failed?.length) { setError(t('部分附件没有恢复。请检查附件列表，保留原备份；不要反复覆盖恢复。') + '\n' + r.failed.map(errorText).join('\n')); return }
    setTimeout(() => location.reload(), 1200)
  }
  return (
    <div className="set-sub">
      <div className="set-sub-h"><b>{t('我的备份')}</b>{showDesc && <small>{t('一个 zip:我名下的全部 + 附件。本机版和线上版通用')}</small>}</div>
      <div className="set-acts">
        <button type="button" className="b" disabled={!!busy} onClick={download}>{busy === 'export' ? <><Spin />{t('在打包…')}</> : t('下载我的备份')}</button>
        <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => restore(e.target.files?.[0])} />
        <button type="button" className="b" disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy === 'import' ? <><Spin />{t('在导入…')}</> : t('用备份恢复…')}</button>
      </div>
      <Note msg={msg} /><ErrorNotice error={error} context={t('备份')} />
    </div>
  )
}

// 机器备份:目录(自己一颗小保存)+ 现在备份 + 最近一次。恢复走启动器,下次打开生效
function MachineBackup({ backupDir, reload }) {
  const [dir, setDir] = useState(backupDir)
  const [saving, setSaving] = useState(false)
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { setDir(backupDir) }, [backupDir])
  const load = () => supa.backup.list().then(setList)
  useEffect(() => { load() }, [backupDir])
  const saveDir = async () => {
    setSaving(true); setMsg('')
    const r = await brainApi.settings.set({ backupDir: dir })
    setSaving(false)
    if (r?.error) return setMsg(t('没存上:') + r.error.message)
    await reload()
  }
  const now = async () => { setBusy(true); setMsg(''); const r = await supa.backup.now(); setBusy(false); setMsg(r.ok ? t('备好了:{f}', { f: r.file.split('/').pop() }) : t('没备成:') + errorText(r.error)); load() }
  const last = list?.files?.[0]
  const dirty = dir.trim() !== backupDir
  return (
    <div className="set-sub">
      <div className="set-sub-h"><b>{t('机器备份')}</b><small>{backupDir ? (list?.error ? t('备份记录读取失败') : last ? t('最近一次 {when}', { when: last.name.replace('fairwind-', '').replace('.tar.gz', '').replace(/-(\d\d)(\d\d)(\d\d)$/, ' $1:$2') }) : t('还没备过')) : t('先选一个备份目录')}</small></div>
      <Field label={t('备份目录')} hint={t('选一个在 iCloud Drive 或 Google Drive 里的')} value={dir} onChange={setDir}
             placeholder="/Users/you/Library/Mobile Documents/com~apple~CloudDocs/Fairwind">
        {dirty && <button type="button" className="b" disabled={saving} onClick={saveDir}>{saving ? <Spin /> : null}{t('保存')}</button>}
      </Field>
      <div className="set-acts">
        <button type="button" className="b" disabled={busy || !backupDir || dirty} onClick={now}>{busy ? <><Spin />{t('在备…')}</> : t('现在备份')}</button>
      </div>
      <Note msg={msg} bad={/^(没|Backup failed|Couldn)/.test(msg)} />
      <ErrorNotice error={list?.error} context={t('机器备份')} onRetry={load} />
    </div>
  )
}

// ── 这台机器(本机才有)──────────────────────────────
// 邮箱只用来在这台机器上认出你;版本 / 检查更新;退出(关网页不等于退出)
function MachineCard({ email, reload }) {
  return (
    <Card title={t('这台机器')} desc={t('都在你这台机器上,不上传')}>
      <EmailField email={email} reload={reload} />
      <div className="set-rows set-divided">
        <UpdateRow />
        <QuitRow />
      </div>
    </Card>
  )
}

function EmailField({ email, reload }) {
  const [v, setV] = useState(email)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { setV(email) }, [email])
  const save = async () => {
    setBusy(true); setMsg('')
    const r = await brainApi.settings.set({ email: v })
    setBusy(false)
    if (r?.error) return setMsg(t('没存上:') + r.error.message)
    await reload()
  }
  return (
    <div className="set-stack">
      <Field label={t('邮箱')} hint={t('只用来在这台机器上认出你')} type="email" value={v} onChange={setV}>
        {v.trim() !== email && <button type="button" className="b" disabled={busy || !v.trim()} onClick={save}>{busy ? <Spin /> : null}{t('保存')}</button>}
      </Field>
      <Note msg={msg} bad />
    </div>
  )
}

function UpdateRow() {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [checked, setChecked] = useState(false)   // 点过「检查更新」:结果没变时也得看得出查过
  useEffect(() => { supa.update.check().then(setInfo) }, [])
  const check = async () => { setBusy(true); setInfo(await supa.update.check(true)); setChecked(true); setBusy(false) }
  const apply = async () => {
    setBusy(true); setMsg('')
    const r = await supa.update.apply(); setBusy(false)
    setMsg(r.ok ? t('装好了 {v}:关掉再打开就是新版', { v: r.version }) : t('没更成:') + errorText(r.error))
  }
  const state = info?.canUpdate ? t(' · 有新版本 {v}', { v: info.latest }) + (info.note ? ':' + info.note : '')
    : info?.error ? (checked ? t(' · 刚查过') : '')
    : info ? (checked ? t(' · 刚查过，已是最新') : t(' · 已是最新')) : ''
  return (
    <div className="set-row">
      <div className="set-row-l">
        <b>{t('版本')}</b>
        <small>{(info?.current || '') + state}</small>
        <Note msg={msg} bad={/^(没|Update failed)/.test(msg)} />
        <ErrorNotice error={info?.error} context={t('检查更新')} onRetry={check} />
      </div>
      <div className="set-acts">
        <button type="button" className="b" disabled={busy} onClick={check}>{busy ? <><Spin />{t('在看…')}</> : t('检查更新')}</button>
        {info?.canUpdate && <button type="button" className="b primary" disabled={busy} onClick={apply}>{t('更新到 {v}', { v: info.latest })}</button>}
      </div>
    </div>
  )
}

function QuitRow() {
  const [gone, setGone] = useState(false)
  const [error, setError] = useState(null)
  const quit = async () => { if (!confirm(t('退出 Fairwind？定时任务和接给 AI 工具的门都会停，再双击 Fairwind 就回来。'))) return; setError(null); const r = await supa.quit(); if (r.error) setError(r.error); else setGone(true) }
  return (
    <div className="set-row">
      <div className="set-row-l"><b>{t('退出')}</b><small>{gone ? t('已退出。要再开，双击 Fairwind。') : t('关掉网页不等于退出，它在后台跑着。')}</small></div>
      <ErrorNotice error={error} context={t('退出 Fairwind')} />
      {!gone && <button type="button" className="b" onClick={quit}>{t('退出 Fairwind')}</button>}
    </div>
  )
}
