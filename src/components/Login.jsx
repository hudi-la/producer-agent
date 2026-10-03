// 登录页。0137 之后 anon 什么都读不到——没登录就没有数据,这页是大门。
//
// 只有 Google 一键(2026-10-03 起):谁来都用自己的 Gmail 登,第一次登就自动开好账号
// (库里的注册触发器给他建档案、出厂任务、默认设置)。邮箱 + 密码那条他说暂时不要,拿掉了;
// Supabase 那边的邮箱登录还开着,以后要再放回来只动这一页。
import { useEffect, useState } from 'react'
import { supa } from '../lib/backends.js'
import { t } from '../i18n/index.js'

export default function Login() {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  // 从 Google 那页按「返回」回来时,浏览器会把这页原样从缓存里拿出来,按钮还停在「……」。复位
  useEffect(() => {
    const reset = (e) => { if (e.persisted) setBusy(false) }
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  // 跳去 Google 登录,回来落在同一个地址,AuthGate 接手。Supabase 后台没配 Google 时会报
  // 「provider is not enabled」,照实说——这不是学员能修的。
  async function google() {
    if (busy) return
    setBusy(true); setNote(null)
    try {
      const { error } = await supa.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } })
      if (error) throw error
    } catch (err) {
      const msg = /not enabled|Unsupported provider/i.test(err.message) ? t('Google 登录还没在后台打开')
        : /Signups not allowed|signup/i.test(err.message) ? t('这个 Google 账号还没开通——把邮箱发给 Hu Di 开一下')
        : err.message
      setNote(msg); setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">Fairwind</h1>
        <p className="login-sub">{t('你的 producer。先认一下人。')}</p>
        <button type="button" className="login-google" disabled={busy} onClick={google}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.5 42.6 14.6 48 24 48z"/></svg>
          {busy ? t('正在去 Google…') : t('用 Google 登录')}
        </button>
        {note && <p className="login-note err">{note}</p>}
        <p className="login-fine">{t('第一次登录会自动开好你的账号。')}<a href="/privacy.html" target="_blank" rel="noreferrer">{t('隐私说明')}</a></p>
      </div>
    </div>
  )
}
