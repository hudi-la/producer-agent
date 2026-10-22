// src/components/ModulesPanel.jsx —— 设置里的三行开关。脑子说能切(canToggle)才出现;
// 他自己那份(service 配置)模块永远全开,这个面板不渲染。
// 线上版(2026-10-06 起)邮件那一行就是「连接 Gmail」:连上 = 邮件开,不用先拨开关再去连(设计稿 D3)。
import { useState } from 'react'
import { useModules } from '../lib/ModulesContext.jsx'
import { BRAIN, brainFetch } from '../lib/backends.js'
import { errorText } from '../lib/userError.js'
import Judgments from './Judgments.jsx'
import { t, getLang } from '../i18n/index.js'

const ROWS = [
  ['profile', t('我的档案'), t('你是谁、作品与履历、语气、书桌。关不掉。')],
  ['pursuits', t('机会线'), t('项目争取的看板、写信稿、找机会。')],
  ['mail', t('邮件'), t('连 Gmail，信自动归线归人；人际管理、时间线、展开的卡片跟它一起开。要先开机会线。')],
]

// Google 授权完把人送回 /?a=settings&gmail=connected|error。地址栏随后会被页面改写,
// 所以在模块一加载就读下来(早于 App 第一次 replaceState)
const BACK = (() => {
  try { const q = new URLSearchParams(window.location.search); return q.get('gmail') ? { gmail: q.get('gmail'), why: q.get('why') || '' } : null }
  catch { return null }
})()

const WHY = {
  expired: t('这次授权超时了（十分钟内要点完），再连一次。'),
  access_denied: t('在 Google 那页按了取消，Gmail 没连上。'),
}

const Ico = ({ children }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

function GmailConnect({ m }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(BACK?.gmail === 'error' ? (WHY[BACK.why] || BACK.why || t('Gmail 没连上，再试一次。')) : '')
  const connected = Boolean(m.gmailAddress)

  const connect = async () => {
    setBusy(true); setErr('')
    try {
      const r = await brainFetch(`${BRAIN}/gmail/connect`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(errorText(j.error) || `HTTP ${r.status}`)
      window.location.assign(j.url)          // 整页去 Google,回来落在设置页
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  const disconnect = async () => {
    setBusy(true); setErr('')
    try {
      const r = await brainFetch(`${BRAIN}/gmail/disconnect`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(errorText(j.error) || `HTTP ${r.status}`)
      await m.set({})                          // 拿脑子那边的新状态盖回来(邮件关、地址空)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="gm-connect">
      {connected ? (
        <div className="cl-ok">
          <span className="cl-check">✓</span>
          <span>{t('已连接')} <b>{m.gmailAddress}</b></span>
          <small>{BACK?.gmail === 'connected' ? t('正在收第一轮信，几分钟后人和来信会出现。') : t('每 5 分钟自动收一次新信。')}</small>
          <button className="b" disabled={busy} onClick={disconnect}>{t('断开')}</button>
        </div>
      ) : (
        <>
          <div className="gm-row">
            <button className="b primary" disabled={busy || !m.pursuits} onClick={connect}>
              {busy ? <span className="spin" /> : <Ico><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></Ico>}
              {t('连接 Gmail')}
            </button>
            {!m.pursuits && <small>{t('要先开机会线。')}</small>}
          </div>
          <small className="gm-hint">{t('会跳到 Google：选你的信箱，看到「Google 尚未验证此应用」点「高级 → 继续」，读信、发信、建草稿每一格都勾上。每个人只连自己的信箱，别人看不到。')}</small>
        </>
      )}
      {err && <p className="cl-err">{err}</p>}
    </div>
  )
}

export default function ModulesPanel() {
  const m = useModules()
  if (!m.canToggle) return null
  const hosted = 'gmailAddress' in m          // 线上版的开关多带一个 gmailAddress;本机版没有
  return (
    // 跟设置页其它卡片同一个样子(set-card):标题 + 一句说明
    <section className="modules-panel set-card">
      <header className="set-card-h"><div><h2>{t('装了哪些')}</h2><p>{t('用到哪块开哪块。我的档案一直开着。')}</p></div></header>
      {getLang() === 'en' && <small className="modules-note">{t('邮件模块的界面暂时还是中文的。')}</small>}
      <div className="modules-list">
      {ROWS.map(([k, name, why]) => {
        // 线上没连 Gmail 时,邮件那个勾拨不动——底下那颗「连接 Gmail」就是开它的地方
        const locked = k === 'profile' || (k === 'mail' && hosted && !m.gmailAddress)
        return (
          <div key={k} className="modules-row">
            <label>
              <input type="checkbox" checked={!!m[k]} disabled={locked} onChange={(e) => m.set({ [k]: e.target.checked })} />
              <b>{name}</b><small>{why}</small>
            </label>
            {k === 'mail' && hosted && <div className="modules-sub"><GmailConnect m={m} /></div>}
            {/* 判据判的是信(要不要回、等多久),归在邮件底下;邮件关着就不露(2026-09-24 他定的) */}
            {k === 'mail' && m.mail && <div className="modules-sub"><Judgments /></div>}
          </div>
        )
      })}
      </div>
    </section>
  )
}
