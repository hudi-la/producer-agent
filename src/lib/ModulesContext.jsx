// src/lib/ModulesContext.jsx —— 模块开关的 context。整个 App 包在里面,门控就是读它。
import { createContext, useContext, useEffect, useState } from 'react'
import { fetchModules, postModules } from './modules.js'

const Ctx = createContext({ profile: true, pursuits: true, mail: true, canToggle: false, set: async () => {} })

export function ModulesProvider({ children }) {
  const [mods, setMods] = useState(null)
  useEffect(() => { fetchModules().then(setMods) }, [])
  if (!mods) return <div className="loading">…</div>
  // 先按你点的画,再拿 brain 算完依赖闭包的真值盖回来——勾选框不该等一次网络往返才动
  const set = async (patch) => {
    const before = mods
    setMods((m) => ({ ...m, ...patch }))
    try { setMods(await postModules(patch)) } catch (e) { setMods(before); alert?.(e.message) }   // 没存成:退回原样
  }
  return <Ctx.Provider value={{ ...mods, set }}>{children}</Ctx.Provider>
}

export const useModules = () => useContext(Ctx)
