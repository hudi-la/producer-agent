// src/lib/bgTask.js —— 页面上的后台任务(2026-10-08):现在只有一件,「把选中的人一个个加进通讯录」。
//
// 原来批量加人在「新联系人」那一块里一个个 await——你一切到别的页面,那一块被卸掉,循环就断了,
// 加到一半停住,还看不出来。现在挪到模块层跑,跟页面在哪无关;右下角的小窗(TaskToast)订阅它的进度。
// 关掉浏览器标签还是会断——跑着的时候离开页面,浏览器会先问一句。
import { useEffect, useState } from 'react'
import { adopt } from './mail.js'

let state = null            // { total, done, failed: [邮箱], current, finished, at }
const subs = new Set()
const emit = (s) => { state = s; for (const f of subs) f(s) }

export function useBgTask() {
  const [s, set] = useState(state)
  useEffect(() => { subs.add(set); set(state); return () => { subs.delete(set) } }, [])
  return s
}
export const bgTaskRunning = () => Boolean(state && !state.finished)
export const clearBgTask = () => emit(null)

const warn = (e) => { e.preventDefault(); e.returnValue = '' }

/** rows = 新联系人那几行(带 判定 / 名字 / 机构 / 头衔 / 来路);onProgress 每加完几个调一次(刷新名单),onDone 全部加完 */
export async function runAdopt(rows, { onProgress, onDone } = {}) {
  if (bgTaskRunning() || !rows.length) return
  emit({ total: rows.length, done: 0, failed: [], current: null, finished: false })
  window.addEventListener('beforeunload', warn)
  try {
    for (const r of rows) {
      emit({ ...state, current: r.名字 || r.信头署名 || r.email })
      const one = () => adopt({ email: r.email, verdict: r.判定, name: r.名字 || r.信头署名 || null,
                                org: r.机构 || (r.判定 === 'shared_box' ? r.email.split('@')[1] : null), role: r.头衔 || null, why: r.来路 || null })
      // 一个没加上**不弹红框**——右下角小窗最后统一说几个没加上(10/8 一次失败三个,红框叠了一屏)。
      // 服务一时不通(重启、网关 502)先等几秒再试一次:10/8 那三个就是赶上脑子发新版重启
      try { await one() }
      catch (e) {
        if (/502|503|504|fetch|network|暂时/i.test(String(e?.message || e))) {
          await new Promise((ok) => setTimeout(ok, 8000))
          try { await one() } catch { state.failed.push(r.email) }
        } else state.failed.push(r.email)
      }
      emit({ ...state, done: state.done + 1 })
      if (state.done % 10 === 0) onProgress?.()
    }
  } finally {
    window.removeEventListener('beforeunload', warn)
    emit({ ...state, current: null, finished: true, at: new Date().toISOString() })
    onDone?.()
  }
}
