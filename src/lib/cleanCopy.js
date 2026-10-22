// 从这儿复制走的东西，不该把这儿的皮肤也带走。
//
// 浏览器复制富文本时，会把选区祖先的**计算样式**内联进剪贴板的 HTML ——
// 气泡的 background-color、纸色、字体全在里面。粘进 Gmail 就是一块纸色底，
// 在白底的信里非常刺眼，而且得手动清格式才能发出去。
//
// 抽屉那边更糟：`.drawer` 自己带 background: var(--paper)（整页那边没有任何
// 带背景的容器，只有 body，而 body 一般不进内联样式）。所以同一段话在整页
// 复制干净、在抽屉里复制出来带底色 —— 多的那一层就是抽屉自己。
//
// 治法不是改配色（那是这个界面该长的样子），是在复制这一步只交出**结构**：
// 段落、粗体、列表、链接留着，一切装饰扒掉。到了邮箱里它穿邮箱自己的衣服。

// 这几个属性是内容的一部分，不是装饰，得留。其余（class / style / id /
// data-* / aria-*）一律不留 —— 出了这个应用它们什么也不是。
const KEEP = { A: ['href'], IMG: ['src', 'alt'] }

function scrub(root) {
  for (const el of root.querySelectorAll('*')) {
    const keep = KEEP[el.tagName] || []
    for (const a of [...el.attributes]) {
      if (!keep.includes(a.name)) el.removeAttribute(a.name)
    }
  }
}

const esc = (s) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))

/**
 * 挂在 document 上的 copy 处理（**捕获阶段**，见下面注册处）。
 *
 * 自己拿选区重新序列化一份：`cloneContents()` 给的是原始 DOM，样式全在 CSS 类里，
 * 扒掉 class 就什么装饰都不剩了 —— 不用去逐条删 background 这类声明，
 * 那种做法漏一条就前功尽弃。
 */
export function cleanCopy(e) {
  try {
    const el = e.target
    const tag = el?.tagName

    // 输入框单独处理，不能直接放过。
    // Chrome 连 textarea 的选区都会附一份 text/html，里面带着外层算出来的
    // 背景色 —— 从输入框里复制一句话粘进 Gmail，照样是一块纸色底。
    // 输入框里的东西本来就是纯文本，那就只给纯文本。
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const t = String(el.value ?? '').slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)
      if (!t) return
      e.clipboardData.setData('text/plain', t)
      e.clipboardData.setData('text/html', esc(t))
      e.preventDefault()
      return
    }

    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return

    const box = document.createElement('div')
    for (let i = 0; i < sel.rangeCount; i++) box.appendChild(sel.getRangeAt(i).cloneContents())
    scrub(box)
    // 什么都没克隆出来（Shadow DOM 之类）就别接管 —— 交出一份空剪贴板
    // 比带底色糟得多。
    if (!box.innerHTML.trim()) return

    // 两份都给：粘进富文本编辑器（Gmail）拿 html，粘进纯文本框拿 plain。
    // 只给 html 的话，纯文本那头会拿到一坨标签。
    e.clipboardData.setData('text/html', box.innerHTML)
    e.clipboardData.setData('text/plain', sel.toString())
    e.preventDefault()
  } catch (_) {
    // 这里抛错最坏的后果不是「复制失败」，是**悄悄退回浏览器自己的复制**，
    // 于是底色又回来了，而且看起来像这个修复根本没写过。宁可吞掉。
  }
}
