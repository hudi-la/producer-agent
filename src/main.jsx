import React from 'react'
import { createRoot } from 'react-dom/client'
import AuthGate from './components/AuthGate.jsx'
import { ModulesProvider } from './lib/ModulesContext.jsx'
import { supa, DB_MODE } from './lib/backends.js'
import { setLang } from './i18n/index.js'
import './styles.css'

// 语言要在 App 及其组件**被 import 之前**定下来:好些文件在模块顶层就把标签算好了
//(AREAS、FIELDS、ROWS…),那时 t() 已经跑过。所以先问 /me,再动态 import App。
// 云端模式没有 /me,永远中文——他自己那份一个字不变。
async function boot() {
  if (DB_MODE === 'local') {
    try { const me = await supa.whoami(); if (me?.lang) setLang(me.lang) } catch (_) {}
  }
  const { default: App } = await import('./App.jsx')
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <AuthGate>
        <ModulesProvider>
          <App />
        </ModulesProvider>
      </AuthGate>
    </React.StrictMode>,
  )
}
boot()
