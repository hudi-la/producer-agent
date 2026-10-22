import React from 'react'
import Veil from './Veil.jsx'
import { t } from '../i18n/index.js'

// 工作区底下那一排：桌上开着的窗口。只在「工作区」亮着时渲染——
// 放在别的区底下，任何人都会当成那个区的分栏，可它混着线和人。
// 名字对不上（数据没到 / 卡被删了）画个占位，× 照样能关：格子不许因为名字丢了就消失。
// 线的名字不盖小花（那是机会，不是人）；人和机构的盖。
// unread：哪几格是「Fairwind 说了话你还没读到」。红点跟看板上那张卡是同一颗，
// 读了就灭——所以你一眼看得出这一排里哪个是新的。
export default function DeskTabs({ tabs, at, unread = new Set(), onPick, onClose }) {
  return (
    <div className="subbar desk-tabs" role="tablist" aria-label={t('桌上开着的')}>
      {tabs.map((tab) => (
        <div key={tab.k} className={'dtab' + (tab.k === at ? ' on' : '')} role="presentation">
          <button type="button" role="tab" aria-selected={tab.k === at} className="dtab-t" onClick={() => onPick(tab.k)}>
            <span className={'dtab-k ' + tab.kind + (unread.has(tab.k) ? ' new' : '')}
                  aria-label={unread.has(tab.k) ? t('Fairwind 回复了') : undefined}
                  aria-hidden={unread.has(tab.k) ? undefined : 'true'} />
            {tab.name === null ? <em>…</em> : tab.kind === 'pursuit' ? tab.name : <Veil>{tab.name}</Veil>}
          </button>
          <button type="button" className="dtab-x" aria-label={t('关掉')} title={t('关掉（从桌上拿走，卡里什么都不碰）')} onClick={() => onClose(tab.k)}>×</button>
        </div>
      ))}
    </div>
  )
}
