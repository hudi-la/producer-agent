import { configureErrorLogging } from './lib/errorTelemetry.js'
import ErrorCenter from './components/ErrorCenter.jsx'
import React, { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import AuthGate from './components/AuthGate.jsx'
import { ModulesProvider } from './lib/ModulesContext.jsx'
import { supa, DB_MODE, BRAIN } from './lib/backends.js'
import { setLang } from './i18n/index.js'
import './styles.css'

// 语言要在 App 及其组件**被 import 之前**定下来:好些文件在模块顶层就把标签算好了
//(AREAS、FIELDS、ROWS…),那时 t() 已经跑过。
//   本机:没有登录这回事,进门前先问 /me,再放 App 进来。
//   云端 / 托管:/me 要带登录凭证才答(2026-10-02 起三种配置都有 /me),所以由 AuthGate
//   在会话到手之后问,问完才放行;App 做成 lazy,大门开了才真正 import——语言那时已定。
//   演示模式(没配库):中文。
const App = React.lazy(() => import('./App.jsx'))

async function boot() {
  if (DB_MODE !== 'none') configureErrorLogging(`${BRAIN}/diagnostics/errors`)
  if (DB_MODE === 'local') {
    try { const me = await supa.whoami(); if (me?.lang) setLang(me.lang) } catch (_) {}
  }
  // 托管版默认英文(2026-10-03):登录页先说英文,登录后按账号设置的语言(新账号默认也是英文)
  if (DB_MODE === 'cloud') setLang('en')
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorCenter />
      <AuthGate>
        <ModulesProvider>
          <Suspense fallback={<div className="loading">…</div>}>
            <App />
          </Suspense>
        </ModulesProvider>
      </AuthGate>
    </React.StrictMode>,
  )
}
boot()
