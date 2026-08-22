import React from 'react'

// 过卡时的那一条：你在第几张、前后翻、把这张移出去。
//
// 抽出来是因为**队里现在混着两种东西**：机会线和人（queue.js 从一开始就
// 是这么设计的——`kind='pursuit'` / `kind='contact'` 混在同一队里过——
// 只是人那一半一直没接上）。2026-08-21 接上之后，机会线的抽屉和人的卡片
// 都要显示它，抄两遍迟早分叉：一边改了「移出」的措辞，另一边还是旧的。
//
// 「移出」就一个意思：这张从这一摞里拿走，卡里什么都不碰。
// 它不说「这件事我干完了」——干没干完看内容（草稿定没定稿、信回没回）。
// 想先放着 = 翻页 ‹ › 走过去、或者关掉，它下次还在原位。
// inHead：横在卡片头条里（人的名片）。默认那身样式是给机会线抽屉的竖排用的，
// 带一条下边框、底部还留白——横过来就成了半截多余的线。
export default function QueueNav({ queue, onPrev, onNext, onDone, inHead = false }) {
  if (!queue) return null
  return (
    <div className={'qnav' + (inHead ? ' in-head' : '')}>
      <button className="qarrow" onClick={onPrev} disabled={queue.i <= 0} aria-label="上一张">‹</button>
      <span className="qcount">{queue.i + 1} / {queue.n}</span>
      <button className="qarrow" onClick={onNext} disabled={queue.i >= queue.n - 1} aria-label="下一张">›</button>
      <span className="qsp" />
      <button className="wbtn" onClick={onDone}>移出</button>
    </div>
  )
}
