import React from 'react'

// 剩下的你这一轮全放过了。不无限转圈——转圈会让你以为还有活没干完，
// 其实你每一张都看过了、都决定了先不动。
export default function QueueRest({ n, onClose }) {
  return (
    <div className="qrest">
      <p className="qrest-t">剩下 {n} 张这轮你都先放着了</p>
      <p className="qrest-s">它们还在队里，明天再来。</p>
      <button className="btn" onClick={onClose}>收起</button>
    </div>
  )
}
