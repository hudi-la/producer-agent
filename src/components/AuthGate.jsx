// 大门。三种放行:
//   没配库(.env.local 空着)→ 直接进,App 自己回落到种子数据——演示模式照旧
//   配了库 + 有会话        → 进
//   配了库 + 没会话        → 登录页
//
// 特意做成 main.jsx 里的一层包装,而不是改 App.jsx:App.jsx 是他的
// 个人分支上最活跃的文件,少碰一行,合并少疼一次。
import { useEffect, useRef, useState } from 'react'
import { supa, DB_CONFIGURED, DB_MODE, brainFetch } from '../lib/backends.js'
import Login from './Login.jsx'
import FirstRun from './FirstRun.jsx'
import { setLang, getLang } from '../i18n/index.js'

export default function AuthGate({ children }) {
  // undefined = 还在问,null = 没登录,对象 = 会话
  const [session, setSession] = useState(undefined)
  // 云端 / 托管:语言在脑子的 /me 里(member_settings.lang),得带着会话去问。问完记下是替谁问的——
  // 令牌刷新会换一个 session 对象但人没换,不能因此把 App 卸了重装(桌上开着的东西会丢)。
  const [langFor, setLangFor] = useState(null)
  const shown = useRef(false)   // App 已经露过面:语言这时再变,顶层算好的标签不会跟着变,只能重开

  useEffect(() => {
    if (!DB_CONFIGURED) return
    // 本机模式还没初始化(没填邮箱和 key):data.local 为真、session 为空 → 首次启动页,不是登录页
    supa.auth.getSession().then(({ data }) => { if (data.lang) setLang(data.lang); setSession(data.session ?? (data.local ? 'first-run' : null)) })
    const { data: sub } = supa.auth.onAuthStateChange((_ev, s) => setSession(s ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session && session !== 'first-run' ? session.user?.id || null : null
  useEffect(() => {
    if (DB_MODE !== 'cloud' || !uid) return
    let on = true
    brainFetch('/me').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((me) => {
      if (!on) return
      const lang = me?.lang === 'en' ? 'en' : 'zh'
      if (lang !== getLang()) { setLang(lang); if (shown.current) { location.reload(); return } }
      setLangFor(uid)
    })
    return () => { on = false }
  }, [uid])

  if (!DB_CONFIGURED) return children
  if (session === undefined) return <div className="loading">…</div>
  if (session === 'first-run') return <FirstRun onDone={() => location.reload()} />
  if (!session) return <Login />
  if (DB_MODE === 'cloud' && langFor !== uid) return <div className="loading">…</div>
  shown.current = true
  return children
}
