// 「飞进购物车」：点了「展开」，一个带卡名的小标签从按钮飞到顶栏「展开的卡片」上。
//
// 状态该翻面的地方（按钮、顶栏数字、卡角记号）照旧**当场**翻，不等动画——动画
// 不承载任何事实，只回答一件事：东西去了哪。所以它失败了（找不到目标、
// 用户关了动效）什么都不影响，静静跳过。
// 不引库：一个 fixed 的小元素 + Web Animations API，飞完自己删掉。
export function flyTo(fromEl, toEl, label) {
  if (!fromEl || !toEl || typeof fromEl.getBoundingClientRect !== 'function') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { land(toEl); return }
  const a = fromEl.getBoundingClientRect()
  const b = toEl.getBoundingClientRect()
  const el = document.createElement('span')
  el.className = 'fly'
  el.textContent = label || ''
  el.setAttribute('aria-hidden', 'true')
  document.body.appendChild(el)
  const w = el.offsetWidth, h = el.offsetHeight
  const x0 = a.left + a.width / 2 - w / 2, y0 = a.top + a.height / 2 - h / 2
  const x1 = b.left + b.width / 2 - w / 2, y1 = b.top + b.height / 2 - h / 2
  el.style.left = `${x0}px`; el.style.top = `${y0}px`
  // 中途往上抬一点，走一道弧，不是直线滑过去——直线像滑块，弧线像扔过去的。
  const lift = Math.max(40, Math.abs(y0 - y1) * 0.35)
  const dx = x1 - x0, dy = y1 - y0
  const anim = el.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(.85)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(.25)`, opacity: 0.2, offset: 1 },
  ], { duration: 560, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards' })
  const finish = () => { el.remove(); land(toEl) }
  anim.onfinish = finish
  anim.oncancel = () => el.remove()
  // 万一 onfinish 没来（标签页切走时动画会被冻住），兜底清掉，别留一个飘着的标签。
  setTimeout(() => { if (el.isConnected) finish() }, 1200)
}

/** 落地：目标弹一下。用 class 而不是 animate，样式归 CSS 管。 */
function land(toEl) {
  if (!toEl?.classList) return
  toEl.classList.remove('landed')
  void toEl.offsetWidth          // 重新触发动画
  toEl.classList.add('landed')
  setTimeout(() => toEl.classList.remove('landed'), 500)
}
