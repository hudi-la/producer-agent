// 登录页。0118 之后 anon 什么都读不到——没登录就没有数据,这页是大门。
//
// 只做邮箱 + 密码:workshop 学员一人一个账号,课前装机时注册。
// 注册后 Supabase 默认要点邮箱里的确认信;提示写清楚,别让人对着
// 「Email not confirmed」猜。
import { useState } from 'react'
import { supa } from '../lib/backends.js'

export default function Login() {
  const [mode, setMode] = useState('in')          // in = 登录,up = 注册
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)          // { kind: 'err'|'ok', text }

  async function go(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setNote(null)
    try {
      if (mode === 'in') {
        const { error } = await supa.auth.signInWithPassword({ email, password })
        if (error) throw error
        // 成功后 AuthGate 的 onAuthStateChange 会接手,这页自己消失
      } else {
        const { data, error } = await supa.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) setNote({ kind: 'ok', text: '注册好了。去邮箱点一下确认信,再回来登录。' })
      }
    } catch (err) {
      const msg = /Invalid login credentials/.test(err.message) ? '邮箱或密码不对'
        : /Email not confirmed/.test(err.message) ? '邮箱还没确认——去收件箱找那封确认信'
        : err.message
      setNote({ kind: 'err', text: msg })
    } finally { setBusy(false) }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={go}>
        <h1 className="login-title">Fairwind</h1>
        <p className="login-sub">你的 producer。先认一下人。</p>
        <label>
          邮箱
          <input type="email" value={email} autoComplete="email" required
                 onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          密码
          <input type="password" value={password} required minLength={8}
                 autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                 onChange={(e) => setPassword(e.target.value)} />
        </label>
        {note && <p className={'login-note ' + note.kind}>{note.text}</p>}
        <button type="submit" disabled={busy}>
          {busy ? '……' : mode === 'in' ? '登录' : '注册'}
        </button>
        <button type="button" className="login-flip"
                onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setNote(null) }}>
          {mode === 'in' ? '还没有账号?注册一个' : '已有账号?去登录'}
        </button>
      </form>
    </div>
  )
}
