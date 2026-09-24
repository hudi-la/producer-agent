// src/components/SettingsPage.jsx —— 本机模式的「设置」:装了哪些、账号(语言/模型来源/备份/更新/接 Claude Code)。
// 公开版右上角那颗按钮进这儿;他自己那份(云端)没有这一页——那儿右上角是展示模式。
import { t } from '../i18n/index.js'
import ModulesPanel from './ModulesPanel.jsx'
import { LocalAccount } from './Identity.jsx'

export default function SettingsPage() {
  return (
    <section className="settings-page">
      <header className="lib-head"><h1>{t('设置')}</h1></header>
      <ModulesPanel />
      <LocalAccount />
    </section>
  )
}
