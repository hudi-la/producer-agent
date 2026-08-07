import React from 'react'
import { FILTERS } from '../lib/filters.js'

// 二级工具条：**左边镜头（看哪些），右边动作（干什么）。**
//
// 原来这儿是四个死 tab（按阶段/按截止/按作品/按来源）。撤了，不留位——
// 它们说的是「怎么排」，而看板已经按阶段排了，天生互相打架。
// 空着可以，假着不行。
//
// 这一刀右边只有两个真按钮。「更新最新信息」是第二刀的，那时候再加——
// 现在放一个还不能用的，就是刚撤掉的那个病。
export default function Subbar({
  filters, onToggleFilter,
  picking, pickedCount, hiddenPickedCount,
  onStartPick, onCancelPick, onPickAll,
  onOpenTasks,
}) {
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

      {/* 切镜头**不清空**勾选（那是「看不见 = 丢了」的近亲），
          但也不能假装它们都在眼前 —— 所以照实说。 */}
      {picking && (
        <span className="pickinfo">
          已选 {pickedCount} 张
          {hiddenPickedCount > 0 && <em>（{hiddenPickedCount} 张不在当前视图）</em>}
        </span>
      )}

      <span className="sp" />

      {picking ? (
        <>
          <button className="wbtn" disabled={!pickedCount} onClick={onPickAll}>过一遍</button>
          <button className="btn" onClick={onCancelPick}>取消</button>
        </>
      ) : (
        <>
          <button className="wbtn" onClick={onStartPick}>批量操作</button>
          <button className="wbtn" onClick={onOpenTasks}>造卡任务</button>
        </>
      )}
    </div>
  )
}
