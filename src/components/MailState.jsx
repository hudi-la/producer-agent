import React from 'react'

// 邮件那一轮现在怎么样。不是按钮——按钮会让人以为「不按就不收」，
// 而事实相反：它一直在收，除非脑子没开。所以这儿只说实话。
// 2026-09-02 从二级带子搬上顶栏：它是全局的事，不归哪个区管。
export default function MailState({ state }) {
  if (!state) return <span className="mailst off">脑子没开 · 没人在收信</span>
  if (state.running) return <span className="mailst">正在收信……</span>
  if (state.ok === false) return <span className="mailst bad">{state.note}</span>
  if (!state.at) return <span className="mailst">邮件：还没跑过第一轮</span>
  const min = Math.round((Date.now() - new Date(state.at).getTime()) / 60000)
  const ago = min < 1 ? '刚刚' : min < 60 ? `${min} 分钟前` : `${Math.round(min / 60)} 小时前`
  return <span className={'mailst' + (min > 20 ? ' bad' : '')}>邮件：{ago}收过 · {state.note}</span>
}
