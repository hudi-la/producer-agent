import { createContext, useContext } from 'react'

// 「展示模式」—— 给客户看屏幕时盖在私人信息上的那层纱。
//
// 开着的时候，页面上**结构化的**私人信息（联系人名字、邮箱、机构、
// 你自己的档案字段）一律换成一朵小花。信件正文、往来摘要这类自由文本
// 这一版不盖（2026-08-25 他拍的：程序认不出一段话里哪几个词是名字，
// 与其假装盖了，不如先明说不盖）。
//
// 开关状态存 localStorage：演示中途手一抖刷新了页面，不能全露出来。

export const VeilContext = createContext(false)

/** 这会儿是不是展示模式。包在 <Veil> 里的字靠它决定露不露。 */
export const useVeiled = () => useContext(VeilContext)

const KEY = 'pa_veil'
export const loadVeiled = () => {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
export const saveVeiled = (on) => {
  try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY) } catch { /* 无痕模式没有 localStorage，开关退化成只活这一页 */ }
}
