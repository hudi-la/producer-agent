import React from 'react'
import Veil from './Veil.jsx'

// 工作区底下那一排：桌上开着的窗口。只在「工作区」亮着时渲染——
// 放在别的区底下，任何人都会当成那个区的分栏，可它混着线和人。
// 名字对不上（数据没到 / 卡被删了）画个占位，× 照样能关：格子不许因为名字丢了就消失。
// 线的名字不盖小花（那是机会，不是人）；人和机构的盖。
export default function DeskTabs({ tabs, at, onPick, onClose }) {
  return (
    <div className="subbar desk-tabs" role="tablist" aria-label="桌上开着的">
      {tabs.map((t) => (
        <div key={t.k} className={'dtab' + (t.k === at ? ' on' : '')} role="presentation">
          <button type="button" role="tab" aria-selected={t.k === at} className="dtab-t" onClick={() => onPick(t.k)}>
            <span className={'dtab-k ' + t.kind} aria-hidden="true" />
            {t.name === null ? <em>…</em> : t.kind === 'pursuit' ? t.name : <Veil>{t.name}</Veil>}
          </button>
          <button type="button" className="dtab-x" aria-label="关掉" title="关掉（从桌上拿走，卡里什么都不碰）" onClick={() => onClose(t.k)}>×</button>
        </div>
      ))}
    </div>
  )
}
