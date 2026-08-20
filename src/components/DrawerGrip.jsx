import { useRef } from 'react'

// 抽屉左沿那条可以拉的边。
//
// 拉的是 --drawer-w 那一个数，不是抽屉的 style —— 看板的右内边距
// （.wrap.drawered .board）吃的也是它，所以一拉，末尾那几列让出的地方
// 跟着一起变；分成两个数迟早有一天对不上，末尾那列又滑不出抽屉底下了。
// 写在 documentElement 上：--drawer-w 本来就声明在 :root，覆盖在同一处最省事。
//
// **宽度存在 localStorage，这一处是故意的。** 项目里别的东西（过卡、✕ 的记号）
// 都从 localStorage 搬进了库，因为那些是「你处理到哪儿了」——两台机器上必须
// 是同一份。可抽屉多宽是「这块屏幕上多宽合适」：笔记本 13 寸和台式机 27 寸
// 本来就该是两个数，跨设备同步它反而是错的。

const KEY = 'pa_drawer_w'
const MIN = 360          // 再窄就装不下卡里那些话了
const KEEP = 280         // 左边至少给看板留这么多，不然拉着拉着看板就没了

const clamp = (w) => Math.max(MIN, Math.min(w, window.innerWidth - KEEP))
const put = (w) => document.documentElement.style.setProperty('--drawer-w', `${Math.round(w)}px`)

/** 开机就把上次那个宽度摆回去。在 App 的挂载 effect 里叫一次。
 *  不放在 DrawerGrip 自己的 effect 里：那样抽屉是先按默认宽度画出来、
 *  下一帧才跳到你的宽度——每次开抽屉都闪一下。 */
export function restoreDrawerWidth() {
  const w = Number(localStorage.getItem(KEY))
  if (Number.isFinite(w) && w > 0) put(clamp(w))
}

export default function DrawerGrip() {
  const dragging = useRef(false)

  // 抽屉本身有多宽 —— 键盘微调要从当前值起步，读 DOM 比另存一份 state 靠谱
  const width = (el) => el.parentElement.getBoundingClientRect().width

  const start = (e) => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    // 拉的时候整页别选中文字、光标别变回箭头
    document.body.classList.add('resizing')
  }
  const move = (e) => {
    if (!dragging.current) return
    put(clamp(window.innerWidth - e.clientX))
  }
  const end = (e) => {
    if (!dragging.current) return
    dragging.current = false
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    document.body.classList.remove('resizing')
    localStorage.setItem(KEY, String(Math.round(width(e.currentTarget))))
  }

  // 键盘也能拉。左右一次 24px，Home 回到默认 —— 一个只有鼠标够得着的
  // 控件，对键盘用户就是不存在。
  const key = (e) => {
    const d = e.key === 'ArrowLeft' ? 24 : e.key === 'ArrowRight' ? -24 : 0
    if (d) {
      e.preventDefault()
      const w = clamp(width(e.currentTarget) + d)
      put(w)
      localStorage.setItem(KEY, String(Math.round(w)))
    } else if (e.key === 'Home') {
      e.preventDefault()
      reset()
    }
  }

  // 双击回到默认宽度：把覆盖撤掉，:root 里那句 max(400px, 33vw) 自己接回来
  const reset = () => {
    document.documentElement.style.removeProperty('--drawer-w')
    localStorage.removeItem(KEY)
  }

  return (
    <div
      className="drawer-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="拉这里改抽屉宽度（双击回到默认）"
      tabIndex={0}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={reset}
      onKeyDown={key}
    />
  )
}
