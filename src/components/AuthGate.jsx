import ErrorNotice from './ErrorNotice.jsx'
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
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const retry = () => { setError(null); setAttempt((n) => n + 1) }
  const [session, setSession] = useState(undefined)
  // 云端 / 托管:语言在脑子的 /me 里(member_settings.lang),得带着会话去问。问完记下是替谁问的——
  // 令牌刷新会换一个 session 对象但人没换,不能因此把 App 卸了重装(桌上开着的东西会丢)。
  const [langFor, setLangFor] = useState(null)
  const [orient, setOrient] = useState(false)   // 托管:进门那页还没走过
  const shown = useRef(false)   // App 已经露过面:语言这时再变,顶层算好的标签不会跟着变,只能重开

  // 登录失效(2026-10-07):原来 /me 回 401 就摆一大块「Authorization failed」,人看不懂也出不去——
  // 浏览器里那份旧登录一直在,刷新还是它。现在:清掉旧的,回登录页,说一句「登录过期了」
  const [expired, setExpired] = useState(false)
  const dropStale = async () => { try { await supa.auth.signOut({ scope: 'local' }) } catch (_) {} setExpired(true); setError(null); setSession(null) }

  useEffect(() => {
    if (!DB_CONFIGURED) return
    // 带着测试账号的登录链接进来(?token_hash=…):先把这个浏览器里原来的登录清掉,不然旧的(可能已经作废)挡在前面,
    // 登录页那颗「以测试账号登录」根本出不来
    if (DB_MODE === 'cloud' && new URLSearchParams(location.search).get('token_hash')) {
      supa.auth.signOut({ scope: 'local' }).catch(() => {}).finally(() => setSession(null))
      return
    }
    // 本机模式还没初始化(没填邮箱和 key):data.local 为真、session 为空 → 首次启动页,不是登录页
    supa.auth.getSession().then(({ data, error }) => { if (error) throw error; if (data.lang) setLang(data.lang); setSession(data.session ?? (data.local ? 'first-run' : null)) })
      .catch((e) => (DB_MODE === 'cloud' && /refresh|session|jwt|token|expired/i.test(e?.message || '') ? dropStale() : setError(e)))   // 旧登录续不上 = 过期,回登录页
    const { data: sub } = supa.auth.onAuthStateChange((_ev, s) => { setError(null); setSession(s ?? null) })
    return () => sub.subscription.unsubscribe()
  }, [attempt])

  const uid = session && session !== 'first-run' ? session.user?.id || null : null
  useEffect(() => {
    if (DB_MODE !== 'cloud' || !uid) return
    let on = true
    brainFetch('/me').then(async (r) => { if (r.status === 401) { const e = new Error('expired'); e.expired = true; throw e } if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }).then((me) => {
      if (me?.error) throw me.error
      if (!on) return
      const lang = me?.lang === 'en' ? 'en' : 'zh'
      setOrient(me?.mode === 'hosted' && me.onboarded === false)
      if (lang !== getLang()) { setLang(lang); if (shown.current) { location.reload(); return } }
      setLangFor(uid)
    }).catch((e) => { if (!on) return; if (e?.expired) dropStale(); else setError(e) })
    return () => { on = false }
  }, [uid, attempt])

  if (!DB_CONFIGURED) return children
  if (error) return <div className="login-page"><div className="login-card"><h1>Fairwind</h1><ErrorNotice error={error} onRetry={retry} /></div></div>
  if (session === undefined) return <div className="loading">…</div>
  if (session === 'first-run') return <FirstRun onDone={() => location.reload()} />
  if (!session) return <Login expired={expired} />
  if (DB_MODE === 'cloud' && langFor !== uid) return <div className="loading">…</div>
  if (orient) return <FirstRun hosted onDone={() => location.reload()} />
  shown.current = true
  return children
}
