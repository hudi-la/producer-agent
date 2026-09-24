// src/components/FirstRun.jsx —— 本机模式第一次打开:先选语言,再问三样,写进 brain 的 settings.json。
// 能不问就不问:库、Gmail 应用都出厂了;这儿只问属于这个人自己的东西。
import { useState } from 'react'
import { supa } from '../lib/backends.js'
import { t, setLang } from '../i18n/index.js'
import ProviderPicker from './ProviderPicker.jsx'

export default function FirstRun({ onDone }) {
  const [lang, setLangState] = useState('zh')
  const [email, setEmail] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState('claude-key')
  const [token, setToken] = useState('')
  const [backupDir, setBackupDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const pick = (l) => { setLang(l); setLangState(l) }   // 当场切,这页自己就换语言

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const r = await supa.setup({ lang, email: email.trim(), provider, apiKey: apiKey.trim(), oauthToken: token.trim(), backupDir: backupDir.trim() })
    setBusy(false)
    if (r.error) return setErr(r.error.message)
    if (!r.ready) return setErr(provider === 'claude-key' ? t('邮箱和 API key 都要填') : t('邮箱和登录令牌都要填'))
    onDone?.()
  }

  return (
    <div className="first-run">
      <form onSubmit={submit}>
        <div className="fr-lang" role="radiogroup" aria-label="Language / 语言">
          <button type="button" className={lang === 'zh' ? 'on' : ''} onClick={() => pick('zh')}>中文</button>
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => pick('en')}>English</button>
        </div>
        <h1>{t('第一次打开')}</h1>
        <p>{t('三样东西。都在你自己这台机器上，不上传。')}</p>
        <label>{t('你的邮箱')}<small>{t('只用来在这台机器上认出你')}</small>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <ProviderPicker value={provider} onChange={setProvider} apiKey={apiKey} onApiKey={setApiKey} token={token} onToken={setToken} />
        <label>{t('备份放哪个文件夹')}<small>{t('选一个在 iCloud Drive 或 Google Drive 里的，备份就自动上了你自己的云。可以先空着')}</small>
          <input value={backupDir} onChange={(e) => setBackupDir(e.target.value)} placeholder="/Users/you/Library/Mobile Documents/com~apple~CloudDocs/Fairwind" /></label>
        {err && <p className="first-run-err">{err}</p>}
        <button disabled={busy}>{busy ? t('写好了…') : t('开始')}</button>
      </form>
    </div>
  )
}
