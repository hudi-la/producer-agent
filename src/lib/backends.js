import { createClient } from '@supabase/supabase-js'

// 两个后端在哪、通不通。
//
// 以前三个 loader 各建一个 supabase 客户端、各自失败各自沉默；
// 「通不通」这件事没有一个统一的说法，所以界面只能笼统显示「种子数据」。
// 现在集中在这儿，好让出问题时能说清是哪儿出的问题。

// import.meta.env 是 Vite 注进来的，`node --test` 里没有这东西——不兜的话，
// 任何 import 到这儿的模块一进测试就崩在第 9 行，于是「碰库的模块一律测不了」。
// 兜住之后 supa 是 null，跟「没填 .env.local」同一条路，测试里正好当没连库使。
const env = import.meta.env || {}

const url = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY

export const supa = url && anon ? createClient(url, anon) : null
export const DB_CONFIGURED = !!supa

export const BRAIN = env.VITE_BRAIN_URL || 'http://localhost:8788'

/** 退回种子数据的原因。null = 没退，看到的是真数据。 */
export const FELL_BACK = {
  NO_CONFIG: 'no-config',       // .env.local 里没填 Supabase
  QUERY_FAILED: 'query-failed', // 填了但连不上 / 查询报错
  EMPTY: 'empty',               // 连上了，但库里一行都没有
}

/**
 * Fairwind 的脑子（本机 sidecar）醒着没有。
 * 它没醒 = 新机会的卡不会被自动读透，也没法对话——但数据仍是真的，
 * 所以这跟「看到假数据」是两种严重程度，界面上要分开说。
 */
// 脑子是你手动 `npm run brain` 起的常驻进程。改了它的代码不重启，它就一直跑旧的，
// 而界面完全看不出来——这已经害过一次：把「讲懂」改成后台扫之后，前端触发器删了、
// 后台扫描没跑起来，整整一天没有一张新卡被读过，谁也没发现。
// 所以两边各存一个日期，对不上就提示重启。改 brain/server.js 的行为时两处一起改。
export const BRAIN_BUILD = '2026-09-03a'

export async function checkBrain() {
  try {
    const res = await fetch(`${BRAIN}/health`, { method: 'GET' })
    if (!res.ok) return { up: false, stale: false, mail: null }
    const body = await res.json().catch(() => ({}))
    // mail = 邮件那一轮的状态。**收信只发生在脑子里**，所以脑子没开
    // 就等于没人在收信——这件事必须让界面说出来，不能静默。
    return { up: true, stale: body.build !== BRAIN_BUILD, mail: body.mail || null }
  } catch (_) {
    return { up: false, stale: false, mail: null }
  }
}
