// 登录页。0118 之后 anon 什么都读不到——没登录就没有数据,这页是大门。
//
// 两条路:Google 一键(2026-10-02 起,托管版学员用 Gmail 账号,一下就进)和邮箱 + 密码(备用)。
// 托管版自助注册是关着的(账号作者在 Supabase 后台建):Google 登录只认已建好的那几个邮箱,
// 没建的会被 Supabase 拒,提示写清楚。注册后 Supabase 默认要点邮箱里的确认信;提示也写清楚。
import { useState } from 'react'
import { supa } from '../lib/backends.js'

export default function Login() {
  const [mode, setMode] = useState('in')          // in = 登录,up = 注册
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)          // { kind: 'err'|'ok', text }

  // Google:跳去 Google 登录,回来落在同一个地址,AuthGate 接手。Supabase 后台没配 Google 时会报
  // 「provider is not enabled」,照实显示——这不是学员能修的,是作者那边的一次性动作。
  async function google() {
    if (busy) return
    setBusy(true); setNote(null)
    try {
      const { error } = await supa.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } })
      if (error) throw error
    } catch (err) {
      const msg = /not enabled|Unsupported provider/i.test(err.message) ? 'Google 登录还没在后台打开;先用邮箱 + 密码'
        : /Signups not allowed|signup/i.test(err.message) ? '这个 Google 账号还没开通——把邮箱发给 Hu Di 开一下'
        : err.message
      setNote({ kind: 'err', text: msg }); setBusy(false)
    }
  }

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
        : /Signups not allowed/i.test(err.message) ? '这里不开放注册——把邮箱发给 Hu Di 开一下'
        : err.message
      setNote({ kind: 'err', text: msg })
    } finally { setBusy(false) }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={go}>
        <h1 className="login-title">Fairwind</h1>
        <p className="login-sub">你的 producer。先认一下人。</p>
        <button type="button" className="login-google" disabled={busy} onClick={google}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.5 42.6 14.6 48 24 48z"/></svg>
          用 Google 登录
        </button>
        <div className="login-or"><span>或者邮箱 + 密码</span></div>
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
