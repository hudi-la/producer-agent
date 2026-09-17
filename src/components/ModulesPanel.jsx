// src/components/ModulesPanel.jsx —— 设置里的三行开关。只在本机模式出现(canToggle);
// 云端模式模块永远全开,这个面板不渲染。
import { useModules } from '../lib/ModulesContext.jsx'

const ROWS = [
  ['profile', '我的档案', '你是谁、作品与履历、语气、书桌。关不掉。'],
  ['pursuits', '机会线', '看板、人、时间线、写信稿、找机会。'],
  ['mail', '邮件', '连 Gmail，信自动归线归人。要先开机会线。'],
]

export default function ModulesPanel() {
  const m = useModules()
  if (!m.canToggle) return null
  return (
    <section className="modules-panel">
      <h3>装了哪些</h3>
      {ROWS.map(([k, name, why]) => (
        <label key={k}>
          <input type="checkbox" checked={!!m[k]} disabled={k === 'profile'} onChange={(e) => m.set({ [k]: e.target.checked })} />
          <b>{name}</b><small>{why}</small>
        </label>
      ))}
    </section>
  )
}
