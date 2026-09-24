// src/components/ModulesPanel.jsx —— 设置里的三行开关。只在本机模式出现(canToggle);
// 云端模式模块永远全开,这个面板不渲染。
import { useModules } from '../lib/ModulesContext.jsx'
import Judgments from './Judgments.jsx'
import { t, getLang } from '../i18n/index.js'

const ROWS = [
  ['profile', t('我的档案'), t('你是谁、作品与履历、语气、书桌。关不掉。')],
  ['pursuits', t('机会线'), t('项目争取的看板、写信稿、找机会。')],
  ['mail', t('邮件'), t('连 Gmail，信自动归线归人；人际管理、时间线、展开的卡片跟它一起开。要先开机会线。')],
]

export default function ModulesPanel() {
  const m = useModules()
  if (!m.canToggle) return null
  return (
    <section className="modules-panel">
      <h3>{t('装了哪些')}</h3>
      {getLang() === 'en' && <small className="modules-note">{t('邮件模块的界面暂时还是中文的。')}</small>}
      {ROWS.map(([k, name, why]) => (
        <div key={k} className="modules-row">
          <label>
            <input type="checkbox" checked={!!m[k]} disabled={k === 'profile'} onChange={(e) => m.set({ [k]: e.target.checked })} />
            <b>{name}</b><small>{why}</small>
          </label>
          {/* 判据判的是信(要不要回、等多久),归在邮件底下;邮件关着就不露(2026-09-24 他定的) */}
          {k === 'mail' && m.mail && <div className="modules-sub"><Judgments /></div>}
        </div>
      ))}
    </section>
  )
}
