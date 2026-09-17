// 大门。三种放行:
//   没配库(.env.local 空着)→ 直接进,App 自己回落到种子数据——演示模式照旧
//   配了库 + 有会话        → 进
//   配了库 + 没会话        → 登录页
//
// 特意做成 main.jsx 里的一层包装,而不是改 App.jsx:App.jsx 是他的
// 个人分支上最活跃的文件,少碰一行,合并少疼一次。
import { useEffect, useState } from 'react'
import { supa, DB_CONFIGURED } from '../lib/backends.js'
import Login from './Login.jsx'
import FirstRun from './FirstRun.jsx'

export default function AuthGate({ children }) {
  // undefined = 还在问,null = 没登录,对象 = 会话
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    if (!DB_CONFIGURED) return
    // 本机模式还没初始化(没填邮箱和 key):data.local 为真、session 为空 → 首次启动页,不是登录页
    supa.auth.getSession().then(({ data }) => setSession(data.session ?? (data.local ? 'first-run' : null)))
    const { data: sub } = supa.auth.onAuthStateChange((_ev, s) => setSession(s ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!DB_CONFIGURED) return children
  if (session === undefined) return <div className="loading">…</div>
  if (session === 'first-run') return <FirstRun onDone={() => location.reload()} />
  if (!session) return <Login />
  return children
}
