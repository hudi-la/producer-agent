import { useEffect } from 'react'

// 输入框按内容长高。
//
// **往上长，不往下长**：框浮在底部（.composer-dock 是 bottom 锚定的），所以
// 高度一涨，涨出来的部分只能往上顶——你正在打的那一行始终停在原地，手不用追着框跑。
// 往下长的话每换一行光标就往下掉一截，还会把底下的东西推出屏幕。
//
// 必须**先归零再量** scrollHeight：不归零的话 scrollHeight 永远不小于当前高度，
// 删字的时候框只会长不会缩。上限在 CSS 的 max-height（38vh），到顶了 textarea 自己滚。
//
// 抽出来是因为机会线和名片是同一个框的两处——抄两遍迟早分叉，
// 而事实上已经分叉过一次：名片那边整段漏了，框永远一行高（2026-09-06 他撞上的）。
export function useGrow(ref, value) {
  useEffect(() => {
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
  }, [ref, value])
}
