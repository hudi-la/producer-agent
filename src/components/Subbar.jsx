import React from 'react'
import { FILTERS, NO_FILTERS, anyOn } from '../lib/filters.js'

// 二级工具条：**左边镜头（看哪些），右边动作（干什么）。**
//
// 原来这儿是四个死 tab（按阶段/按截止/按作品/按来源）。撤了，不留位——
// 它们说的是「怎么排」，而看板已经按阶段排了，天生互相打架。
// 空着可以，假着不行。
//
// 右边全是真按钮，没有占位的——放一个还不能用的，就是刚撤掉的那个病。
export default function Subbar({
  filters, onToggleFilter, onSetFilters,
  picking, pickedCount, hiddenPickedCount,
  onStartPick, onCancelPick, onPickAll,
  onOpenTasks, onRefresh, refreshing,
  onSay, saying,
}) {
  return (
    <div className="subbar">
      {/* 两个开关，可以同时按下去 —— 真正有用的恰恰是交叉。
          「全部」不是第三个开关，是一键清零：开着筛选想回全景，
          得一个个关太啰嗦。都关着的时候它亮着，表示你看的就是全部。 */}
      <div className="tabs" role="group" aria-label="看哪些">
        <button
          type="button"
          className={'tab' + (!anyOn(filters) ? ' on' : '')}
          aria-pressed={!anyOn(filters)}
          onClick={() => onSetFilters(NO_FILTERS)}
        >
          全部
        </button>
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

      {/* 系统在报，不能点——所以不进按钮组，灰字带转圈 */}
      {refreshing && (
        <span className="refreshing"><i className="spin" aria-hidden="true" />更新中 {refreshing.i}/{refreshing.n}</span>
      )}
      {saying && (
        <span className="refreshing"><i className="spin" aria-hidden="true" />说给第 {saying.i}/{saying.n} 条</span>
      )}

      <span className="sp" />

      {picking ? (
        <>
          {/* 「说一句…」在前：它是主动作，「过一遍」只是端上工作台 */}
          <button className="wbtn" disabled={!pickedCount || Boolean(saying)} onClick={onSay}>说一句…</button>
          <button className="wbtn" disabled={!pickedCount} onClick={onPickAll}>过一遍</button>
          <button className="btn" onClick={onCancelPick}>取消</button>
        </>
      ) : (
        <>
          <button className="wbtn" disabled={Boolean(refreshing)} onClick={onRefresh}>更新最新信息</button>
          <button className="wbtn" onClick={onStartPick}>批量操作</button>
          <button className="wbtn" onClick={onOpenTasks}>造卡任务</button>
        </>
      )}
    </div>
  )
}
