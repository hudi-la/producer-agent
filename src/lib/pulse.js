import { supa } from './backends.js'
import { t } from '../i18n/index.js'

// 改动计数器 —— 轮询照旧，但每一跳从「整包数据」换成一行几列（几十字节）。
//
// 设计稿：docs/specs/2026-08-21-egress-diet.md
//
// 起因是流量账：三个 setInterval 每 3/5/8 秒把整包数据（连邮件原文）重拉一遍，
// 一天 4.5 GB，免费档一个月才 5 GB。可库里 99% 的时刻什么都没发生——
// 所以先问 v_pa_pulse 那几个数，变了才叫订阅方去真拉。
//
// ══ 为什么是「几个数」而不是一个 ═══════════════════════════════
//
// 一个数只能说「有东西变了」，说不出「哪一块变了」。于是给一个邮箱地址
// 下判断，也会让整个看板重新下载 161 KB —— 而看板的依赖链里根本没有那张表。
// 拆成按区计数之后：HTTP 响应头 912 字节一个字节不变（钱主要花在它身上），
// 返回内容从 10 字节变成约 45 字节，但网页从此知道该重下哪一块。
//
// 区的归属在库里，由 producer.pulse_wire() 从视图依赖关系**自动推导**，
// 不是谁手写的清单（见 0114）。这边只管订阅。
//
// 用法（正好当 effect 用）：
//   useEffect(() => onPulse('board', reload), [依赖])
// 返回退订函数。**它只负责「库动了之后」，不替你做第一次加载**。
//
// 三条脾气：
// · 标签页看不见就不跳（并排开四张，看不见的三张一个字节都不花），
//   切回来立刻补一跳。
// · 读失败（断网、限额打爆）**不停跳、不沉默**：退到约一分钟一次照样叫，
//   让各 loader 自己的「退回种子数据 + 说明原因」照常发生。
// · 失败后第一次读成功，无条件叫一遍：断线期间界面上挂着「连不上」，
//   哪怕库里其实没动，也得让 loader 重拉一次把横幅撤下来。

export const TICK_MS = 4000
export const ERR_EVERY = 15   // 失败时每 15 跳（≈一分钟）才叫一次

// 前端能订阅的区。**必须跟库里 producer.pulse_areas 对得上。**
// 写错一个字就抛错（见下面 onPulse）——漏配要在你第一次打开那个页面时
// 就炸出来，不能变成几周后才发现的「这一栏怎么不更新」。
export const AREAS = ['board', 'thread', 'deliv', 'tasks', 'pool']

/** 拆出来是为了测试：read 和「看得见吗」都可注入。 */
export function makePulse(read, { visible = () => true } = {}) {
  const subs = new Map()   // 区 → Set(回调)
  let last = null          // 上次读到的那一行。null = 还没对过表
  let errRun = 0           // 连续失败了几跳

  const live = () => [...subs.keys()]
  const shout = (areas) => {
    for (const a of areas) {
      for (const fn of [...(subs.get(a) || [])]) { try { fn() } catch (_) {} }
    }
  }

  async function tick() {
    if (!subs.size || !visible()) return
    let row
    try { row = await read() } catch (_) { row = null }

    if (!row) {
      errRun++
      if (errRun % ERR_EVERY === 0) shout(live())
      return
    }

    const recovered = errRun > 0
    errRun = 0
    if (last === null) { last = row; if (recovered) shout(live()); return }

    const changed = live().filter((a) => row[a] !== last[a])
    last = row
    if (recovered) shout(live())        // 缓过来无条件全叫一遍
    else if (changed.length) shout(changed)
  }

  function onPulse(area, fn) {
    if (!AREAS.includes(area)) {
      throw new Error(
        t('没有「{area}」这一区 —— 区名要跟库里 producer.pulse_areas 对得上（现有：{list}）', { area, list: AREAS.join(t('、')) }))
    }
    if (!subs.has(area)) subs.set(area, new Set())
    subs.get(area).add(fn)
    return () => {
      const s = subs.get(area)
      s?.delete(fn)
      if (s && !s.size) subs.delete(area)
    }
  }

  return { tick, onPulse }
}

async function readRow() {
  const { data, error } = await supa.from('v_pa_pulse').select(AREAS.join(',')).maybeSingle()
  if (error) throw new Error(error.message)
  return data ?? null
}

let inst = null

/** 订阅「这一区变了」。没配库就永远不叫（页面上是种子数据，没什么可同步的）。 */
export function onPulse(area, fn) {
  if (!inst) {
    inst = makePulse(readRow, { visible: () => !document.hidden })
    if (supa) {
      setInterval(() => inst.tick(), TICK_MS)
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) inst.tick()
      })
    }
  }
  return inst.onPulse(area, fn)
}
