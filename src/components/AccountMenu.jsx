// src/components/AccountMenu.jsx —— 线上版(托管)右上角:你是谁 + 退出 / 换一个账号。
// 本机版没有登录这回事;他自己的个人版这颗是「展示模式」(给客户看屏幕时盖名字),线上学员用不着。
import { useEffect, useRef, useState } from 'react'
import { supa } from '../lib/backends.js'
import { t } from '../i18n/index.js'

export default function AccountMenu() {
  const [open, setOpen] = useState(false)
  const [user, setUser] = useState(null)
  const [busy, setBusy] = useState(false)
  const box = useRef(null)
  useEffect(() => { supa?.auth.getUser().then(({ data }) => setUser(data?.user || null)) }, [])
  useEffect(() => {
    if (!open) return
    const off = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const meta = user?.user_metadata || {}
  const name = meta.full_name || meta.name || (user?.email || '').split('@')[0] || t('我')
  const pic = meta.avatar_url || meta.picture
  const signOut = async () => { setBusy(true); await supa.auth.signOut(); location.reload() }
  // 换账号:先退出,再直接去 Google 并让它弹出账号选择(不然 Google 会默默用刚才那个)
  const switchAcct = async () => {
    setBusy(true); await supa.auth.signOut()
    await supa.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } })
  }
  return (
    <div className="acct-menu" ref={box}>
      <button type="button" className={'veilbtn acct-btn' + (open ? ' on' : '')} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {pic ? <img src={pic} alt="" referrerPolicy="no-referrer" /> : <span className="acct-dot">{name.slice(0, 1).toUpperCase()}</span>}
        <span>{name}</span>
      </button>
      {open && <div className="acct-pop" role="menu">
        <div className="acct-who"><b>{name}</b><small>{user?.email}</small></div>
        <button type="button" role="menuitem" disabled={busy} onClick={switchAcct}>{t('换一个账号')}</button>
        <button type="button" role="menuitem" disabled={busy} onClick={signOut}>{t('退出登录')}</button>
      </div>}
    </div>
  )
}
