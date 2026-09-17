import { useLayoutEffect } from 'react'

// 输入框按内容长高。**全应用的多行输入框都走这一个**（2026-09-16 起）。
//
// 抽出来是因为这件事已经分叉过两次：
//   · 2026-09-06 名片那边整段漏了，框永远一行高
//   · 2026-09-16 档案书桌的输入框、条目的就地编辑、群发、造卡提示词……
//     11 个多行框里只有 3 个会长高，他打一长段就只能在两行里滚着看
// 每个框各写一遍迟早漏，所以只留这一份。
//
// **往上长，不往下长**（浮在底部的对话框）：框是 bottom 锚定的，高度一涨，
// 涨出来的部分只能往上顶——你正在打的那一行始终停在原地，手不用追着框跑。
// 页面中间的编辑框就是正常往下长。
//
// 必须**先归零再量** scrollHeight：不归零的话 scrollHeight 永远不小于当前高度，
// 删字的时候框只会长不会缩。归零之后的高度由 rows 撑着，所以 rows 就是最矮的样子。
// 上限写在各自 CSS 的 max-height 里，到顶了 textarea 自己滚。
//
// useLayoutEffect 不是 useEffect：量和改在浏览器画之前做完。用 useEffect 的话，
// 点「编辑」那一下框先按 rows 画出来、下一帧才跳到内容高度——每次都闪一下。
//
// deps：除了内容，还要传「这个框刚出现」的那个开关（editing 之类）。
// 只传内容的话，点编辑那一刻内容没变，框就不会被量，一长段文字塞在五行里。
export function useGrow(ref, ...deps) {
  useLayoutEffect(() => {
    const el = ref?.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
    // 框长高了，滚动区底下也得跟着多让出那么多——不然长到三四行的时候，
    // 最后一条对话就被压在框底下：**在，但看不见**。
    // 量的是整组（框 + 「记一笔」那行），写成 --composer-h 挂在这张卡的根上，
    // 由 CSS 去算 padding。写死一个数只在单行时是对的。
    const dock = el.closest('.composer-dock')
    const root = el.closest('.focus')
    if (dock && root) root.style.setProperty('--composer-h', dock.offsetHeight + 'px')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps])
}
