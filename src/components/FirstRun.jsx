import { errorText } from '../lib/userError.js'
import ErrorNotice from './ErrorNotice.jsx'
// src/components/FirstRun.jsx —— 第一次进门:先选语言,再问几样。
//   本机:语言 + 邮箱 + 模型来源 + 备份目录,写进 brain 的 settings.json。
//   托管(hosted,2026-10-03):登录之后过这一页——语言(按浏览器猜,母语最快)+ 模型来源;可以跳过,之后在设置里补。
// 能不问就不问:库、Gmail 应用都出厂了;这儿只问属于这个人自己的东西。
import { useEffect, useState } from 'react'
import { supa, brainApi } from '../lib/backends.js'
import { t, setLang } from '../i18n/index.js'
import ProviderPicker, { Spin } from './ProviderPicker.jsx'

export default function FirstRun({ onDone, hosted = false }) {
  // 默认跟浏览器的语言走(mac 就是系统语言);想换点右上角那两颗
  const guess = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '') ? 'zh' : 'en'
  const [lang, setLangState] = useState(() => { setLang(guess); return guess })
  const [email, setEmail] = useState('')
  const [provider, setProvider] = useState('claude-key')
  const [keys, setKeys] = useState({ apiKey: '', oauthToken: '', openaiKey: '', geminiKey: '' })
  const [backupDir, setBackupDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // 还没初始化也能更新:有新版本就在最上面给一颗按钮,不用先填完三样
  const [upd, setUpd] = useState(null)
  const [updMsg, setUpdMsg] = useState('')
  useEffect(() => { if (!hosted) supa.update?.check?.().then((u) => { if (u?.canUpdate) setUpd(u) }) }, [])
  const applyUpdate = async () => { setUpdMsg(t('在更新…')); const r = await supa.update.apply(); setUpdMsg(r.ok ? t('装好了 {v}:关掉再打开就是新版', { v: r.version }) : t('没更成:') + errorText(r.error)) }
  const pick = (l) => { setLang(l); setLangState(l) }   // 当场切,这页自己就换语言

  // 托管:写进这个人的 member_settings;跳过 = 只存语言并记下「走过了」
  const saveHosted = (body) => brainApi.setup({ lang, onboarded: true, ...body })
  const skip = async () => { setBusy(true); const r = await saveHosted({ skip: true }); setBusy(false); if (r.error) return setErr(errorText(r.error)); onDone?.() }

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    if (hosted) {
      const r = await saveHosted({ provider, ...Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v.trim()])) })
      setBusy(false)
      if (r.error) return setErr(errorText(r.error))
      if (!r.ready) return setErr(provider === 'claude-subscription' ? t('先登录 Claude,或者点下面「先跳过」') : t('填一个 key,或者点下面「先跳过」'))
      return onDone?.()
    }
    const r = await supa.setup({ lang, email: email.trim(), provider, ...Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v.trim()])), backupDir: backupDir.trim() })
    setBusy(false)
    if (r.error) return setErr(errorText(r.error))
    if (!r.ready) return setErr(provider === 'chatgpt-subscription' ? t('填写邮箱并登录 ChatGPT') : provider === 'claude-subscription' ? t('填写邮箱并登录 Claude') : t('邮箱和 API key 都要填'))
    onDone?.()
  }

  return (
    <div className="first-run">
      <form onSubmit={submit}>
        <div className="fr-lang" role="radiogroup" aria-label="Language / 语言">
          <button type="button" className={lang === 'zh' ? 'on' : ''} onClick={() => pick('zh')}>中文</button>
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => pick('en')}>English</button>
        </div>
        {upd && <div className="fr-upd">{t(' · 有新版本 {v}', { v: upd.latest }).replace(/^ · /, '')}{upd.note ? ':' + upd.note : ''} <button type="button" className="b" onClick={applyUpdate}>{t('更新到 {v}', { v: upd.latest })}</button>{updMsg && (updMsg.startsWith(t('没更成:')) ? <ErrorNotice error={updMsg} /> : <small>{updMsg}</small>)}</div>}
        <header className="fr-head">
          <h1>{hosted ? t('欢迎') : t('第一次打开')}</h1>
          <p>{hosted ? t('先选 Fairwind 跟你说哪种语言,再接上你的模型。') : t('三样东西。都在你自己这台机器上，不上传。')}</p>
        </header>
        {!hosted && <label>{t('你的邮箱')}<small>{t('只用来在这台机器上认出你')}</small>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>}
        <section className="fr-sec">
          <div className="fr-sec-h">{t('模型')}</div>
          <ProviderPicker value={provider} onChange={setProvider} keys={keys} onKey={(k, v) => setKeys((s) => ({ ...s, [k]: v }))} />
        </section>
        {!hosted && <label>{t('备份放哪个文件夹')}<small>{t('选一个在 iCloud Drive 或 Google Drive 里的，备份就自动上了你自己的云。可以先空着')}</small>
          <input value={backupDir} onChange={(e) => setBackupDir(e.target.value)} placeholder="/Users/you/Library/Mobile Documents/com~apple~CloudDocs/Fairwind" /></label>}
        {err && <ErrorNotice error={err} context={t('开始使用')} />}
        <footer className="fr-foot">
          <button className="fr-go" disabled={busy}>{busy ? <><Spin />{t('正在保存…')}</> : t('开始使用')}</button>
          {hosted && <button type="button" className="fr-skip" disabled={busy} onClick={skip}>{t('先跳过,以后在设置里接')}</button>}
        </footer>
      </form>
    </div>
  )
}
