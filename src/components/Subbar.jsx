import React from 'react'
import { FILTERS, NO_FILTERS, anyOn } from '../lib/filters.js'

// 二级工具条：**左边镜头（看哪些），右边动作（干什么）。**
//
// 原来这儿是四个死 tab（按阶段/按截止/按作品/按来源）。撤了，不留位——
// 它们说的是「怎么排」，而看板已经按阶段排了，天生互相打架。
// 空着可以，假着不行。
//
// 右边全是真按钮，没有占位的——放一个还不能用的，就是刚撤掉的那个病。
// 邮件那一轮现在怎么样。不是按钮——按钮会让人以为「不按就不收」，
// 而事实相反：它一直在收，除非脑子没开。所以这儿只说实话。
function MailState({ state }) {
  if (!state) return <span className="mailst off">脑子没开 · 没人在收信</span>
  if (state.running) return <span className="mailst">正在收信……</span>
  if (state.ok === false) return <span className="mailst bad">{state.note}</span>
  if (!state.at) return <span className="mailst">邮件：还没跑过第一轮</span>
  const min = Math.round((Date.now() - new Date(state.at).getTime()) / 60000)
  const ago = min < 1 ? '刚刚' : min < 60 ? `${min} 分钟前` : `${Math.round(min / 60)} 小时前`
  return <span className={'mailst' + (min > 20 ? ' bad' : '')}>邮件：{ago}收过 · {state.note}</span>
}

export default function Subbar({
  mail,
  filters, onToggleFilter, onSetFilters,
  picking, pickedCount, hiddenPickedCount,
  onStartPick, onCancelPick, onPickAll,
  onOpenTasks,
  onSay, saying,
  queueCount, onOpenQueue,
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
          {/* 「更新最新信息」删了。
              它跑的是按线拉 thread 的老路——62 条线一条 thread 都没登记，
              所以它跑 65 次、62 次返回「没处可收」，**而真正该做的事
              （去 Gmail 收新信）它一次都没做**。8/11 那批信就是这么在
              库外躺了七个小时的。
              现在收信在脑子里每 5 分钟自己跑。取代按钮的不是「没有反馈」，
              是下面 Trouble 里那句一直在的实话：上次收到什么、脑子开没开。 */}
          <MailState state={mail} />
          <button className="wbtn" onClick={onStartPick}>批量操作</button>
          {/* 队列是批处理生的，就跟批处理站一排（原来在顶栏）。
              队空的时候整个按钮不渲染——不显示「过卡 · 0」，占位就是骗人。 */}
          {queueCount > 0 && (
            <button className="qbtn" onClick={onOpenQueue}>
              <span className="qpile" aria-hidden="true" />过卡 · {queueCount}
            </button>
          )}
          <button className="wbtn" onClick={onOpenTasks}>造卡任务</button>
        </>
      )}
    </div>
  )
}
