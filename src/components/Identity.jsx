import React, { useEffect, useState, useRef } from 'react'
import { t } from '../i18n/index.js'
import { saveProfile, useProfile } from '../lib/profile.js'
import { supa, brainApi, brainFetch, BRAIN } from '../lib/backends.js'
import { EditRow } from './EditRow.jsx'
import ProviderPicker from './ProviderPicker.jsx'
import Judgments from './Judgments.jsx'

// 「关于你」——档案页最上面那一块。
//
// 这些字段本来就在库里（producer.profile），但界面上看不见、改不了，只能开 SQL；
// 而 Fairwind 的 prompt 里还抄着一份写死的（"美国 O-1，常住 LA / 湾区"）。两份会飘。
//
// 现在只有库里那一份，而且你能在这儿改。O-1 变绿卡那天你自己点一下就行。
//
// 为什么这些字段值得单独摆出来：它们是 Fairwind **筛掉一个机会**的依据。
// 排除规则写错了，你会永远看不到某一类机会——而且不会有任何提示。

// key 是 profile.data 里的键；list 表示存的是数组，界面上用「、」分隔。
const FIELDS = [
  // 发信身份不许对不上：**用错身份发出去的信连道歉都没处发**——
  // 对方看到一个陌生地址，而你在自己的已发送里找不到它。brain 那头会当场拒发。
  // veil = 展示模式下盖小花的私人字段。规则类（资助偏好/排除/关注）不盖：
  // 它们讲的是机会怎么筛，正是演示要给人看的；名字/邮箱/身份/常住是你这个人。
  { key: 'email', label: t('邮箱'), veil: true, hint: t('Fairwind 用这个账号发信。必须是你授权给 brain 的那个 Gmail，对不上会当场拒发。') },
  { key: 'visa', label: t('身份'), veil: true, hint: t('例：O-1、绿卡、公民。Fairwind 拿它判断你能不能申。') },
  { key: 'location', label: t('常住'), list: true, veil: true, hint: t('多个地方用「、」分开。') },
  { key: 'career_stage', label: t('阶段'), hint: t('例：emerging、mid-career。') },
  { key: 'funding_pref', label: t('资助偏好'), long: true },
  { key: 'exclude_rule', label: t('排除规则'), long: true, hint: t('满足这条的机会不进主名单。写错了你会看不见一整类机会。') },
  { key: 'watch_rule', label: t('关注规则'), long: true, hint: t('够不着但值得盯的，按这条留下来。') },
]

// 那个 Row 搬去了 EditRow.jsx —— 档案页的条目要用同一套手感（见那个文件顶上的说明）。

export default function Identity({ onSaved }) {
  const profile = useProfile()
  const d = profile?.data || {}

  // 存完把最新的读回来——不然改完这一格，别的地方（卡上的「资格搁置」）还是旧的。
  const after = async (fn) => { await fn(); await onSaved?.() }

  return (
    <section className="kind identity">
      <div className="kind-h">{t('关于你')}</div>
      <div className="idbox">
        <EditRow label={t('名字')} value={profile?.name} veil
             onSave={(v) => after(() => saveProfile({ name: v }))} />
        <EditRow label={t('作品站')} value={profile?.website}
             onSave={(v) => after(() => saveProfile({ website: v }))} />
        {FIELDS.map((f) => (
          <EditRow key={f.key} label={f.label} value={d[f.key]} hint={f.hint} long={f.long} list={f.list} veil={f.veil}
               onSave={(v) => after(() => saveProfile({ data: { [f.key]: v } }))} />
        ))}
      </div>
      <div className="idnote">
        {t('改完 Fairwind 下一次开口就用新的——它读的就是这里，没有第二份。')}
      </div>
      <AccountRow />
    </section>
  )
}

// 账号那一行:登录身份和登出住在「关于你」的最底下——账号的事在账号该住的
// 地方,不占顶栏。没配库(演示模式)时整行不出现。本机模式没有登录这回事,
// 这块换成 LocalAccount:邮箱、API key、模型档位、备份目录——首次启动问过的那几样,
// 之后在这儿改(2026-09-16)。
function AccountRow() {
  const [email, setEmail] = useState(null)
  useEffect(() => {
    if (!supa || supa.mode === 'local') return
    supa.auth.getUser().then(({ data }) => setEmail(data?.user?.email ?? null))
  }, [])
  if (supa?.mode === 'local') return null   // 本机模式:判据和账号都在「设置」(SettingsPage)
  if (!supa || !email) return null
  return (
    <div className="idnote acct">
      {t('登录身份:')}{email}
      <button type="button" className="acct-out" onClick={() => supa.auth.signOut()}>{t('登出')}</button>
    </div>
  )
}

// 账号块。key **永远不回显**:brain 只给「设了没有」和末四位,
// 这儿的输入框空着 = 不动原来的,填了 = 换掉。改完当场生效,brain 不用重启。
//
// 2026-10-02 拆成两层(设计稿八):AccountBlock 是三种配置通用的那几样(语言、模型来源、key、两档模型),
// machine 为真(本机)再长出机器级的:邮箱、备份目录、接入三颗按钮、备份、更新、退出。
// 托管(云端)没有机器这回事:邮箱就是登录身份,改不了;判据编辑器搬到这儿(本机它住在邮件开关底下,线上没有邮件);
// 接 AI 工具的那一行带令牌。
export function LocalAccount() { return <AccountBlock machine /> }
export function HostedAccount() { return <AccountBlock machine={false} /> }

function AccountBlock({ machine }) {
  const [cur, setCur] = useState(null)
  const [asked, setAsked] = useState(false)   // 问过 /settings 了(托管下没答 → 得说一句,不能空着)
  const [form, setForm] = useState({ email: '', apiKey: '', oauthToken: '', openaiKey: '', geminiKey: '', provider: 'claude-key', model: '', modelCheap: '', backupDir: '', lang: 'zh' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const load = () => (brainApi ? brainApi.settings.get() : Promise.resolve(null)).then((s) => { if (s && !s.error) { setCur(s); setForm((f) => ({ ...f, email: s.email, model: s.model, modelCheap: s.modelCheap, backupDir: s.backupDir, lang: s.lang || 'zh', provider: s.provider || 'claude-key', apiKey: '', oauthToken: '', openaiKey: '', geminiKey: '' })) } setAsked(true) })
  useEffect(() => { load() }, [])
  if (!cur) return (!machine && asked) ? <div className="idnote">{t('设置读不到:脑子没应,或它不是托管的那个。')}</div> : null
  const dirty = form.apiKey || form.oauthToken || form.openaiKey || form.geminiKey || form.provider !== (cur.provider || 'claude-key') || form.email !== cur.email || form.model !== cur.model || form.modelCheap !== cur.modelCheap || form.backupDir !== cur.backupDir 
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setNote('')
    const r = await brainApi.settings.set(form)
    setBusy(false)
    if (r?.error) return setNote(t('没存上:') + r.error.message)
    setNote(t('存好了,下一次开口就用新的')); await load()
  }
  const F = ({ k, label, hint, type = 'text', placeholder }) => (
    <label className="la-row">
      <span className="la-k">{label}</span>
      <input type={type} value={form[k]} placeholder={placeholder} autoComplete="off"
             onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
      {hint && <small>{hint}</small>}
    </label>
  )
  return (
    <form className="local-account" onSubmit={save}>
      <div className="kind-h la-h">{t('账号')}<small>{machine ? t('都在你这台机器上,不上传') : (cur.email ? t('登录身份:') + cur.email : '')}</small></div>
      <label className="la-row"><span className="la-k">{t('语言')}</span>
        {/* 选完当场存、整页按新语言重开——之前要先点保存,提示又说"刷新生效",他刷新了当然没变 */}
        <select value={form.lang} onChange={async (e) => { const lang = e.target.value; setForm((f) => ({ ...f, lang })); await brainApi.settings.set({ lang }); location.reload() }}><option value="zh">中文</option><option value="en">English</option></select>
        <small>{t('选完页面会按新语言重开')}</small></label>
      {machine && <F k="email" label={t('邮箱')} type="email" hint={t('只用来在这台机器上认出你')} />}
      <div className="la-row"><span className="la-k">{t('模型来源')}</span>
        <ProviderPicker compact value={form.provider} inUse={cur.provider || 'claude-key'} onChange={(v) => setForm((f) => ({ ...f, provider: v, ...((v === 'chatgpt-subscription' || f.provider === 'chatgpt-subscription') ? { model: '', modelCheap: '' } : {}) }))}
          keys={form} onKey={(k, v) => setForm((f) => ({ ...f, [k]: v }))}
          hints={{ apiKey: cur.apiKeySet ? cur.apiKeyHint : '', oauthToken: cur.oauthTokenSet ? cur.oauthTokenHint : '', openaiKey: cur.openaiKeySet ? cur.openaiKeyHint : '', geminiKey: cur.geminiKeySet ? cur.geminiKeyHint : '' }} /></div>
      <F k="model" label={t('好档模型')} placeholder={t('空 = 默认')} hint={t('聊天、写信、讲懂用这档')} />
      <F k="modelCheap" label={t('便宜档模型')} placeholder={t('空 = 默认')} hint={t('判断、收信那些小活用这档')} />
      {machine && <F k="backupDir" label={t('备份目录')} placeholder="/Users/you/Library/Mobile Documents/com~apple~CloudDocs/Fairwind" hint={t('选一个在 iCloud Drive 或 Google Drive 里的')} />}
      <div className="la-acts">
        <button type="submit" className="b primary" disabled={busy || !dirty}>{busy ? t('存着…') : t('保存')}</button>
        {note && <span className={'la-note' + (note.startsWith(t('没存上:')) ? ' bad' : '')}>{note}</span>}
      </div>
      {machine ? <>
        <McpRow />
        <BackupRow backupDir={cur.backupDir} />
        <UpdateRow />
        <QuitRow />
      </> : <>
        <Judgments />
        <HostedMcpRow token={cur.mcpToken || ''} onRotated={load} />
        <MyBackupRow />
      </>}
    </form>
  )
}

// 托管(云端)的接入:桌面版那三颗「接入」按钮是替人改本机配置文件,线上够不着你的机器——
// 换成一行命令,带着你自己的令牌,粘进哪个工具都行。令牌漏了就「换一串」,旧的当场作废。
function HostedMcpRow({ token, onRotated }) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // 地址按脑子的来(托管下脑子直接服务页面,跟页面同源;他自己那份前端和脑子可能不在一个域)
  const b = new URL(BRAIN)
  const url = `${b.protocol}//user:${token || t('<令牌>')}@${b.host}/mcp`
  const cmd = `<Fairwind>/node mcp-bridge.cjs ${url}`
  const copy = async () => { try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch (_) {} }
  const rotate = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await brainFetch('/settings/mcp-token/rotate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const body = await r.json().catch(() => ({}))
      if (!r.ok || body?.error) throw new Error(body?.error?.message || body?.error || `${r.status}`)
      setMsg(t('换好了。旧的那串从现在起不认;接着的工具要重新粘一次。')); await onRotated?.()
    } catch (e) { setMsg(t('没换成:') + e.message) }
    setBusy(false)
  }
  return (
    <div className="la-sub">
      <div className="la-sub-h">{t('接给你的 AI 工具')}<small>{t('让它能读写你的档案、机会卡、判据——比如"读我的网站，把作品填进来"。')}</small></div>
      <small className="la-hint">{t('本机版那三颗「接入」按钮是替你改这台机器上的配置文件;线上够不着你的机器,换成下面这一行——粘进 Claude 桌面版、Codex、Gemini CLI 的 MCP 配置都行(<Fairwind> 换成你装的位置)。这串里带着你的令牌,别给别人看。')}</small>
      <div className="la-acts">
        <code className="la-cmd">{cmd}</code>
        <button type="button" className="b" onClick={copy}>{copied ? t('复制好了') : t('复制')}</button>
        <a className="b" href={`${BRAIN}/mcp-guide`} target="_blank" rel="noreferrer">{t('说明书')}</a>
      </div>
      <div className="la-acts">
        <button type="button" className="b" disabled={busy} onClick={rotate}>{busy ? t('在换…') : t('换一串')}</button>
        {!token && <small className="la-hint">{t('还没有令牌:点「换一串」生成一串')}</small>}
        {msg && <span className={'la-note' + (msg.startsWith(t('没换成:')) ? ' bad' : '')}>{msg}</span>}
      </div>
    </div>
  )
}

// 接给 Claude Code / GPT 桌面版:一条命令,复制就行。端口按当前页面的来(作者机器上是 8790)
function McpRow() {
  const [copied, setCopied] = useState(false)
  const [targets, setTargets] = useState([])     // 三个能接的桌面工具,各自接没接
  const [msg, setMsg] = useState({})
  const url = `${location.origin}/mcp`
  const cmd = `claude mcp add --transport http fairwind ${url}`
  const load = () => supa.mcpTargets.list().then(setTargets)
  useEffect(() => { load() }, [])
  const copy = async () => { try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch (_) {} }
  const RESTART = { 'claude-desktop': 'Claude', codex: 'Codex', 'gemini-cli': 'Gemini CLI' }
  const install = async (target) => { const r = await supa.mcpTargets.install(target); setMsg((m) => ({ ...m, [target]: r.ok ? t('写好了。把 {app} 完全退出再打开，对话里就有 Fairwind 的工具了', { app: RESTART[target] || t('它') }) : t('没成:') + r.error })); await load() }
  return (
    <div className="la-sub">
      <div className="la-sub-h">{t('接给你的 AI 工具')}<small>{t('让它能读写你的档案、机会卡、判据——比如"读我的网站，把作品填进来"。ChatGPT 聊天 app 接不上（它只认公网地址），用 ChatGPT 的人走 Codex。')}</small></div>
      {targets.map((x) => (
        <div className="la-acts" key={x.target}>
          <b className="la-k2">{t(x.label)}</b>
          <button type="button" className={'b' + (x.current ? '' : ' primary')} onClick={() => install(x.target)}>{x.current ? t('已接入 · 再写一次') : t('接入')}</button>
          {x.appInstalled === false && <small className="la-hint">{t('这台机器上没见到它')}</small>}
          {msg[x.target] && <span className={'la-note' + (msg[x.target].startsWith(t('没成:')) ? ' bad' : '')}>{msg[x.target]}</span>}
        </div>
      ))}
      <div className="la-acts">
        <b className="la-k2">Claude Code</b>
        <code className="la-cmd">{cmd}</code>
        <button type="button" className="b" onClick={copy}>{copied ? t('复制好了') : t('复制')}</button>
        <a className="b" href={`${location.origin}/mcp-guide`} target="_blank" rel="noreferrer">{t('说明书')}</a>
      </div>
      <small className="la-hint">{t('Claude Code 在终端里粘那一行；别的工具怎么接，看说明书。地址：')}<code>{url}</code></small>
    </div>
  )
}

// 备份那一行:最近一次 + 现在备份 + 从备份恢复(下次打开生效)
function BackupRow({ backupDir }) {
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const load = () => supa.backup.list().then(setList)
  useEffect(() => { load() }, [backupDir])
  const now = async () => { setBusy(true); setMsg(''); const r = await supa.backup.now(); setBusy(false); setMsg(r.ok ? t('备好了:{f}', { f: r.file.split('/').pop() }) : t('没备成:') + r.error); load() }
  const last = list?.files?.[0]
  return (
    <>
      <div className="la-sub">
        <div className="la-sub-h">{t('机器备份')}<small>{backupDir ? (last ? t('最近一次 {when}', { when: last.name.replace('fairwind-', '').replace('.tar.gz', '').replace(/-(\d\d)(\d\d)(\d\d)$/, ' $1:$2') }) : t('还没备过')) : t('上面先选一个备份目录')}</small></div>
        <div className="la-acts">
          <button type="button" className="b" disabled={busy || !backupDir} onClick={now}>{busy ? t('在备…') : t('现在备份')}</button>
        </div>
        {msg && <span className={'la-note' + (/^(没|Backup failed|Couldn)/.test(msg) ? ' bad' : '')}>{msg}</span>}
      </div>
      <MyBackupRow />
    </>
  )
}

// 我的备份:一个 zip,我名下所有东西 + 附件。本机和线上同一种,哪边导出都能导进另一边——
// 公司撤了、换电脑、从本机搬上线,都是这两颗(设计稿 2026-10-02 D16)。
function MyBackupRow() {
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const fileRef = useRef(null)
  const api = brainApi
  const download = async () => {
    if (!api) return
    setBusy('export'); setMsg(t('在打包…'))
    try {
      const blob = await api.backup.export()
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fairwind-${new Date().toISOString().slice(0, 10)}.zip`; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
      setMsg(t('下好了:{mb} MB', { mb: (blob.size / 1048576).toFixed(1) }))
    } catch (e) { setMsg(t('没打成:') + e.message) }
    setBusy('')
  }
  const restore = async (file) => {
    if (!file || !api) return
    if (!confirm(t('用这份备份换掉现在的全部?现在库里我名下的行会先清掉,再导进这份。附件同名的覆盖。'))) { fileRef.current.value = ''; return }
    setBusy('import'); setMsg(t('在导入…'))
    const r = await api.backup.import(file, { wipe: true })
    setBusy(''); fileRef.current.value = ''
    if (!r.ok) { setMsg(t('没导成:') + (r.error || '')); return }
    const rows = Object.values(r.tables || {}).reduce((a, b) => a + b, 0)
    setMsg(t('导好了:{rows} 行、{files} 个文件{failed}', { rows, files: r.files, failed: r.failed?.length ? t(';{n} 个文件没传上', { n: r.failed.length }) : '' }))
    setTimeout(() => location.reload(), 1200)
  }
  return (
    <div className="la-sub">
      <div className="la-sub-h">{t('我的备份')}<small>{t('一个 zip:我名下的全部 + 附件。本机版和线上版通用')}</small></div>
      <div className="la-acts">
        <button type="button" className="b" disabled={!!busy} onClick={download}>{busy === 'export' ? t('在打包…') : t('下载我的备份')}</button>
        <input ref={fileRef} type="file" accept=".zip,application/zip" style={{ display: 'none' }} onChange={(e) => restore(e.target.files?.[0])} />
        <button type="button" className="b" disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy === 'import' ? t('在导入…') : t('用备份恢复…')}</button>
      </div>
      {msg && <span className={'la-note' + (/^(没|Couldn|Export failed|Import failed)/.test(msg) ? ' bad' : '')}>{msg}</span>}
    </div>
  )
}

// 更新那一行:版本、检查、有新版就一颗「更新」
function QuitRow() {
  const [gone, setGone] = useState(false)
  const quit = async () => { if (!confirm(t('退出 Fairwind？定时任务和接给 AI 工具的门都会停，再双击 Fairwind 就回来。'))) return; try { await supa.quit() } catch (_) {} setGone(true) }
  return (
    <div className="la-sub">
      <div className="la-sub-h">{t('退出')}<small>{t('关掉网页不等于退出，它在后台跑着。')}</small></div>
      <div className="la-acts">{gone ? <span className="la-note">{t('已退出。要再开，双击 Fairwind。')}</span> : <button type="button" className="b" onClick={quit}>{t('退出 Fairwind')}</button>}</div>
    </div>
  )
}

function UpdateRow() {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { supa.update.check().then(setInfo) }, [])
  const [checked, setChecked] = useState(false)   // 点过「检查更新」:结果没变时也得看得出查过
  const check = async () => { setBusy(true); setInfo(await supa.update.check(true)); setChecked(true); setBusy(false) }
  const apply = async () => {
    setBusy(true); setMsg('')
    const r = await supa.update.apply(); setBusy(false)
    setMsg(r.ok ? t('装好了 {v}:关掉再打开就是新版', { v: r.version }) : t('没更成:') + r.error)
  }
  return (
    <div className="la-sub">
      <div className="la-sub-h">{t('版本')}<small>{info?.current || ''}{info?.canUpdate ? t(' · 有新版本 {v}', { v: info.latest }) + (info.note ? ':' + info.note : '') : info?.error ? (checked ? t(' · 刚查过') : '') + ` · ${t(info.error)}` : info ? (checked ? t(' · 刚查过，已是最新') : t(' · 已是最新')) : ''}</small></div>
      <div className="la-acts">
        <button type="button" className="b" disabled={busy} onClick={check}>{busy ? t('在看…') : t('检查更新')}</button>
        {info?.canUpdate && <button type="button" className="b primary" disabled={busy} onClick={apply}>{t('更新到 {v}', { v: info.latest })}</button>}
        {msg && <span className={'la-note' + (/^(没|Update failed)/.test(msg) ? ' bad' : '')}>{msg}</span>}
      </div>
    </div>
  )
}
