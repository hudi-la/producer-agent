import { supa } from './backends.js'

// 脉搏 —— 轮询照旧，但每一跳从「整包数据」换成一行两列（几十字节）。
//
// 设计稿：docs/specs/2026-08-21-egress-diet.md
//
// 起因是流量账：三个 setInterval 每 3/5/8 秒把整包数据（连邮件原文）
// 重拉一遍，一天 4.5 GB，免费档一个月才 5 GB。可库里 99% 的时刻什么都
// 没发生——所以先问 v_pa_pulse 那一个数（producer 下任何表写入都会 +1，
// 见 0111），数变了才叫订阅方去真拉。
//
// 用法（正好当 effect 用）：
//   useEffect(() => onPulse(reload), [reload 依赖的东西])
// onPulse 返回退订函数。**它只负责「库动了之后」，不替你做第一次加载**
// ——挂载时该拉的自己拉，跟原来一样。
//
// 三条脾气：
// · 标签页不可见就不跳（并排开四张的时候，看不见的三张一个字节都不花），
//   切回来立刻补一跳。
// · 读脉搏失败（断网、限额打爆）**不停跳、不沉默**：退到约一分钟一次
//   照样叫订阅方——loader 们自己会退回种子数据、把原因摆在脸上，
//   这条既有的报错路子不能因为省流量就断了。
// · 失败后第一次读成功，无条件叫一遍：断线期间界面上挂着「连不上」，
//   哪怕库里其实没动，也得让 loader 重新拉一次真数据把横幅撤下来。

export const TICK_MS = 4000
export const ERR_EVERY = 15   // 失败时每 15 跳（≈一分钟）才叫一次

/** 拆出来是为了测试：read 和「可见吗」都可注入。 */
export function makePulse(read, { visible = () => true } = {}) {
  const subs = new Set()
  let last = null     // 上次看到的 n。null = 还没对上过表（第一次成功只记账不叫人）
  let errRun = 0      // 连续失败了几跳

  const shout = () => { for (const fn of [...subs]) { try { fn() } catch (_) {} } }

  async function tick() {
    if (!subs.size || !visible()) return
    let n
    try { n = await read() } catch (_) { n = null }
    if (n === null || n === undefined) {
      errRun++
      if (errRun % ERR_EVERY === 0) shout()
      return
    }
    const recovered = errRun > 0
    const changed = last !== null && n !== last
    last = n
    errRun = 0
    if (changed || recovered) shout()
  }

  return { tick, onPulse: (fn) => { subs.add(fn); return () => subs.delete(fn) } }
}

async function readN() {
  const { data, error } = await supa.from('v_pa_pulse').select('n').maybeSingle()
  if (error) throw new Error(error.message)
  return data?.n ?? null
}

let inst = null

/** 订阅「库里动了」。没配库就永远不叫（页面上是种子数据，没什么可同步的）。 */
export function onPulse(fn) {
  if (!inst) {
    inst = makePulse(readN, { visible: () => !document.hidden })
    if (supa) {
      setInterval(() => inst.tick(), TICK_MS)
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) inst.tick()
      })
    }
  }
  return inst.onPulse(fn)
}
