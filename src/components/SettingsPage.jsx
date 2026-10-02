// src/components/SettingsPage.jsx —— 「设置」:装了哪些、账号(语言/模型来源/key/两档模型)、接 AI 工具。
// 本机(公开版):再加机器级的——备份目录、备份、更新、退出、三颗接入按钮(LocalAccount)。
// 云端 / 托管(2026-10-02 起,设计稿八):同一页,账号块换成 HostedAccount——没有机器那几行,
// 判据编辑器和带令牌的接入命令住在这儿;邮件那行开关按脑子说的(mailOffered)藏。
import { t } from '../i18n/index.js'
import { DB_MODE } from '../lib/backends.js'
import ModulesPanel from './ModulesPanel.jsx'
import { LocalAccount, HostedAccount } from './Identity.jsx'

export default function SettingsPage() {
  return (
    // 外层 .page 是各区共用的滚动层(.wrap 固定高度不滚);里层限宽
    <section className="page settings-page">
      <div className="settings-inner">
        <header className="lib-head"><h1>{t('设置')}</h1></header>
        <ModulesPanel />
        {DB_MODE === 'local' ? <LocalAccount /> : <HostedAccount />}
      </div>
    </section>
  )
}
