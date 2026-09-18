// src/i18n/index.js —— 界面的中英文。
//
// 键就是中文原文:代码里照旧写中文,包一层 t();英文在 en.js 里按原文查。
// 查不到 = 原样给中文(他自己那份永远是中文,一个字不变;英文没覆盖到的地方也不会变成空白)。
// 语言从 settings.lang 来(本机模式,/me 带着),云端模式永远 zh。换语言要刷新页面。
import en from './en.js'

const DICTS = { zh: null, en }
let LANG = 'zh'

export function setLang(l) { LANG = DICTS[l] === undefined ? 'zh' : l }
export function getLang() { return LANG }

/** t('中文原文') / t('已有 {n} 条', { n }) */
export function t(key, vars) {
  const d = DICTS[LANG]
  let s = (d && d[key]) || key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

/** 英文里没覆盖的键(开发时看):传一堆键,回没翻的 */
export function untranslated(keys) { return keys.filter((k) => !en[k]) }
