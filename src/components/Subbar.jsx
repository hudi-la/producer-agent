import React from 'react'
import { FILTERS } from '../lib/filters.js'

// 二级工具条：**左边镜头（看哪些），右边动作（干什么）。**
//
// 原来这儿是四个死 tab（按阶段/按截止/按作品/按来源）。撤了，不留位——
// 它们说的是「怎么排」，而看板已经按阶段排了，天生互相打架。
// 空着可以，假着不行。
export default function Subbar({ filters, onToggleFilter, onOpenTasks }) {
  return (
    <div className="subbar">
      {/* 两个开关，可以同时按下去 —— 真正有用的恰恰是交叉。
          所以没有「全部」那个按钮：它就是"什么都不按"。 */}
      <div className="tabs" role="group" aria-label="看哪些">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={'tab' + (filters[key] ? ' on' : '')}
            aria-pressed={Boolean(filters[key])}
            onClick={() => onToggleFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <span className="sp" />

      <button className="wbtn" onClick={onOpenTasks}>造卡任务</button>
    </div>
  )
}
