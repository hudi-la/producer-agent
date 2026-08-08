import React, { useEffect, useRef, useState } from 'react'

// 左栏那些折叠的小池子。
//
// 点击开合，不用 hover：左栏一列全是池子，鼠标滑过去会一路闪，
// 而且触控板上「滑过」和「想看」根本分不开。开着的池子标题变琥珀色，
// 一眼看得出你正开着哪几格。
//
// action —— 挂在标题行上的一个动作（比如邮件那格的「收信」）。
// 它必须在标题行上，不能埋进池子里：池子收起来的时候你就够不着了，
// 而「去收一下信」恰恰是你不想先展开就能按的那种动作。
// 结构上它是 pool-head 这个开合按钮的**兄弟**，不是子元素——
// button 套 button 是非法的，点一下会两个都触发。
export default function Pool({ title, count, action, announce, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)

  // 里头多了东西就自己弹开。
  // 不加这句的话：你在右栏按了「定稿」，左栏这格是收起来的，于是屏幕上什么也没发生——
  // 东西确实进去了，但你看不见，跟没进去没区别。
  const prev = useRef(count)
  useEffect(() => {
    if (prev.current !== count && count && !String(count).startsWith('0')) setOpen(true)
    prev.current = count
  }, [count])

  // 有话要说也自己弹开：动作按在标题行上，而结果写在池子里——
  // 池子要是收着的，你按完什么反馈都看不到，就会以为这一下没按上。
  // 失败尤其要弹：静默失败是最坏的，你会以为「没新信」，其实是同步断了。
  useEffect(() => { if (announce) setOpen(true) }, [announce])

  return (
    <div className={'pool' + (open ? ' open' : '')}>
      <div className="pool-headrow">
        <button className="pool-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="chev" aria-hidden="true">▸</span>
          <b>{title}</b>
        </button>
        {action}
        {count != null && <span className="n">{count}</span>}
      </div>
      {open && <div className="pool-body">{children}</div>}
    </div>
  )
}
