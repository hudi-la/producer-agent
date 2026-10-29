import { useEffect, useRef } from 'react'
const stack = []
const selector = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"], [contenteditable="true"]'
export function useDialogFocus(open, onClose) {
  const ref = useRef(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const panel = ref.current
    if (!open || !panel) return
    const previous = document.activeElement
    stack.push(panel)
    const items = () => [...panel.querySelectorAll(selector)].filter(el => !el.closest('[hidden], [inert]') && el.getClientRects().length)
    if (!panel.contains(document.activeElement)) (items()[0] || panel).focus()
    const key = e => {
      if (stack.at(-1) !== panel) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close.current?.(); return }
      if (e.key !== 'Tab') return
      const list = items(), first = list[0], last = list.at(-1)
      if (!first) { e.preventDefault(); panel.focus(); return }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel || !panel.contains(document.activeElement))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('keydown', key, true)
      const top = stack.at(-1) === panel
      const index = stack.indexOf(panel)
      if (index >= 0) stack.splice(index, 1)
      if (top && previous?.isConnected) previous.focus()
    }
  }, [open])
  return ref
}
