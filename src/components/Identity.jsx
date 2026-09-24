import React, { useEffect, useState } from 'react'
import { t } from '../i18n/index.js'
import { saveProfile, useProfile } from '../lib/profile.js'
import { supa } from '../lib/backends.js'
import { EditRow } from './EditRow.jsx'
import Judgments from './Judgments.jsx'
import ProviderPicker from './ProviderPicker.jsx'

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
  if (supa?.mode === 'local') return <><Judgments /><LocalAccount /></>
  if (!supa || !email) return null
  return (
    <div className="idnote acct">
      {t('登录身份:')}{email}
      <button type="button" className="acct-out" onClick={() => supa.auth.signOut()}>{t('登出')}</button>
    </div>
  )
}

// 本机模式的账号块。key **永远不回显**:brain 只给「设了没有」和末四位,
// 这儿的输入框空着 = 不动原来的,填了 = 换掉。改完当场生效,brain 不用重启。
function LocalAccount() {
  const [cur, setCur] = useState(null)
  const [form, setForm] = useState({ email: '', apiKey: '', oauthToken: '', openaiKey: '', geminiKey: '', provider: 'claude-key', model: '', modelCheap: '', backupDir: '', lang: 'zh' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const load = () => supa.settings.get().then((s) => { if (s) { setCur(s); setForm((f) => ({ ...f, email: s.email, model: s.model, modelCheap: s.modelCheap, backupDir: s.backupDir, lang: s.lang || 'zh', provider: s.provider || 'claude-key', apiKey: '', oauthToken: '', openaiKey: '', geminiKey: '' })) } })
  useEffect(() => { load() }, [])
  if (!cur) return null
  const dirty = form.apiKey || form.oauthToken || form.openaiKey || form.geminiKey || form.provider !== (cur.provider || 'claude-key') || form.email !== cur.email || form.model !== cur.model || form.modelCheap !== cur.modelCheap || form.backupDir !== cur.backupDir || form.lang !== (cur.lang || 'zh')
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setNote('')
    const r = await supa.settings.set(form)
    setBusy(false)
    if (r?.error) return setNote(t('没存上:') + r.error.message)
    if (form.lang !== (cur.lang || 'zh')) { location.reload(); return }   // 换语言:整页按新语言重来
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
      <div className="kind-h la-h">{t('账号')}<small>{t('都在你这台机器上,不上传')}</small></div>
      <label className="la-row"><span className="la-k">{t('语言')}</span>
        <select value={form.lang} onChange={(e) => setForm((f) => ({ ...f, lang: e.target.value }))}><option value="zh">中文</option><option value="en">English</option></select>
        <small>{t('换语言后刷新页面生效')}</small></label>
      <F k="email" label={t('邮箱')} type="email" hint={t('只用来在这台机器上认出你')} />
      <div className="la-row"><span className="la-k">{t('模型来源')}</span>
        <ProviderPicker compact value={form.provider} onChange={(v) => setForm((f) => ({ ...f, provider: v }))}
          keys={form} onKey={(k, v) => setForm((f) => ({ ...f, [k]: v }))}
          hints={{ apiKey: cur.apiKeySet ? cur.apiKeyHint : '', oauthToken: cur.oauthTokenSet ? cur.oauthTokenHint : '', openaiKey: cur.openaiKeySet ? cur.openaiKeyHint : '', geminiKey: cur.geminiKeySet ? cur.geminiKeyHint : '' }} /></div>
      <F k="model" label={t('好档模型')} placeholder={t('空 = 默认')} hint={t('聊天、写信、讲懂用这档')} />
      <F k="modelCheap" label={t('便宜档模型')} placeholder={t('空 = 默认')} hint={t('判断、收信那些小活用这档')} />
      <F k="backupDir" label={t('备份目录')} placeholder="/Users/you/Library/Mobile Documents/com~apple~CloudDocs/Fairwind" hint={t('选一个在 iCloud Drive 或 Google Drive 里的')} />
      <div className="la-acts">
        <button type="submit" className="b primary" disabled={busy || !dirty}>{busy ? t('存着…') : t('保存')}</button>
        {note && <span className={'la-note' + (note.startsWith(t('没存上:')) ? ' bad' : '')}>{note}</span>}
      </div>
      <McpRow />
      <BackupRow backupDir={cur.backupDir} />
      <UpdateRow />
    </form>
  )
}

// 接给 Claude Code / GPT 桌面版:一条命令,复制就行。端口按当前页面的来(作者机器上是 8790)
function McpRow() {
  const [copied, setCopied] = useState(false)
  const url = `${location.origin}/mcp`
  const cmd = `claude mcp add --transport http fairwind ${url}`
  const copy = async () => { try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch (_) {} }
  return (
    <div className="la-sub">
      <div className="la-sub-h">{t('接给 Claude Code')}<small>{t('让 Claude Code（或 GPT 桌面版）能读写你的档案——比如"读我的网站，把作品填进来"')}</small></div>
      <div className="la-acts">
        <code className="la-cmd">{cmd}</code>
        <button type="button" className="b" onClick={copy}>{copied ? t('复制好了') : t('复制')}</button>
      </div>
      <small className="la-hint">{t('在终端里粘这一行；GPT 桌面版在它的连接器设置里填这个地址：')}<code>{url}</code></small>
    </div>
  )
}

// 备份那一行:最近一次 + 现在备份 + 从备份恢复(下次打开生效)
function BackupRow({ backupDir }) {
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [pathIn, setPathIn] = useState('')
  const load = () => supa.backup.list().then(setList)
  useEffect(() => { load() }, [backupDir])
  const now = async () => { setBusy(true); setMsg(''); const r = await supa.backup.now(); setBusy(false); setMsg(r.ok ? t('备好了:{f}', { f: r.file.split('/').pop() }) : t('没备成:') + r.error); load() }
  const restore = async () => {
    if (!pathIn.trim()) return
    if (!confirm(t('用这份备份换掉现在的库?现在的库会改名留着,不删。关掉再打开 Fairwind 才生效。'))) return
    const r = await supa.backup.restore(pathIn.trim()); setMsg(r.ok ? t('排好了:关掉再打开就是恢复后的') : t('没排上:') + r.error)
  }
  const last = list?.files?.[0]
  return (
    <div className="la-sub">
      <div className="la-sub-h">{t('备份')}<small>{backupDir ? (last ? t('最近一次 {when}', { when: last.name.replace('fairwind-', '').replace('.tar.gz', '').replace(/-(\d\d)(\d\d)(\d\d)$/, ' $1:$2') }) : t('还没备过')) : t('上面先选一个备份目录')}</small></div>
      <div className="la-acts">
        <button type="button" className="b" disabled={busy || !backupDir} onClick={now}>{busy ? t('在备…') : t('现在备份')}</button>
        <input className="la-path" placeholder={t('从备份恢复:贴一份 .tar.gz 的路径')} value={pathIn} onChange={(e) => setPathIn(e.target.value)} />
        <button type="button" className="b" disabled={!pathIn.trim()} onClick={restore}>{t('恢复…')}</button>
      </div>
      {msg && <span className={'la-note' + (/^(没|Backup failed|Couldn)/.test(msg) ? ' bad' : '')}>{msg}</span>}
    </div>
  )
}

// 更新那一行:版本、检查、有新版就一颗「更新」
function UpdateRow() {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { supa.update.check().then(setInfo) }, [])
  const check = async () => { setBusy(true); setInfo(await supa.update.check(true)); setBusy(false) }
  const apply = async () => {
    setBusy(true); setMsg('')
    const r = await supa.update.apply(); setBusy(false)
    setMsg(r.ok ? t('装好了 {v}:关掉再打开就是新版', { v: r.version }) : t('没更成:') + r.error)
  }
  return (
    <div className="la-sub">
      <div className="la-sub-h">{t('版本')}<small>{info?.current || ''}{info?.canUpdate ? t(' · 有新版本 {v}', { v: info.latest }) + (info.note ? ':' + info.note : '') : info?.error ? ` · ${info.error}` : info ? t(' · 已是最新') : ''}</small></div>
      <div className="la-acts">
        <button type="button" className="b" disabled={busy} onClick={check}>{busy ? t('在看…') : t('检查更新')}</button>
        {info?.canUpdate && <button type="button" className="b primary" disabled={busy} onClick={apply}>{t('更新到 {v}', { v: info.latest })}</button>}
        {msg && <span className={'la-note' + (/^(没|Update failed)/.test(msg) ? ' bad' : '')}>{msg}</span>}
      </div>
    </div>
  )
}
