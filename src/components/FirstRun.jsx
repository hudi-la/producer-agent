// src/components/FirstRun.jsx —— 本机模式第一次打开:问三样,写进 brain 的 settings.json。
// 能不问就不问:库、Gmail 应用都出厂了;这儿只问属于这个人自己的东西。
import { useState } from 'react'
import { supa } from '../lib/backends.js'

export default function FirstRun({ onDone }) {
  const [email, setEmail] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [backupDir, setBackupDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const r = await supa.setup({ email: email.trim(), apiKey: apiKey.trim(), backupDir: backupDir.trim() })
    setBusy(false)
    if (r.error) return setErr(r.error.message)
    if (!r.ready) return setErr('邮箱和 API key 都要填')
    onDone?.()
  }

  return (
    <div className="first-run">
      <form onSubmit={submit}>
        <h1>第一次打开</h1>
        <p>三样东西。都在你自己这台机器上，不上传。</p>
        <label>你的邮箱<small>只用来在这台机器上认出你</small>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label>Anthropic API key<small>模型的钱走你自己的 key。去 console.anthropic.com 建一个（sk-ant- 开头）</small>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required /></label>
        <label>备份放哪个文件夹<small>选一个在 iCloud Drive 或 Google Drive 里的，备份就自动上了你自己的云。可以先空着</small>
          <input value={backupDir} onChange={(e) => setBackupDir(e.target.value)} placeholder="/Users/你/Library/Mobile Documents/com~apple~CloudDocs/Fairwind" /></label>
        {err && <p className="first-run-err">{err}</p>}
        <button disabled={busy}>{busy ? '写好了…' : '开始'}</button>
      </form>
    </div>
  )
}
