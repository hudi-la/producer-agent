import { createClient } from '@supabase/supabase-js'

// 两个后端在哪、通不通。
//
// 以前三个 loader 各建一个 supabase 客户端、各自失败各自沉默；
// 「通不通」这件事没有一个统一的说法，所以界面只能笼统显示「种子数据」。
// 现在集中在这儿，好让出问题时能说清是哪儿出的问题。

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supa = url && anon ? createClient(url, anon) : null
export const DB_CONFIGURED = !!supa

export const BRAIN = import.meta.env.VITE_BRAIN_URL || 'http://localhost:8788'

/** 退回种子数据的原因。null = 没退，看到的是真数据。 */
export const FELL_BACK = {
  NO_CONFIG: 'no-config',       // .env.local 里没填 Supabase
  QUERY_FAILED: 'query-failed', // 填了但连不上 / 查询报错
  EMPTY: 'empty',               // 连上了，但库里一行都没有
}

/**
 * 渡的脑子（本机 sidecar）醒着没有。
 * 它没醒 = 待批准的卡不会被自动读透，也没法对话——但数据仍是真的，
 * 所以这跟「看到假数据」是两种严重程度，界面上要分开说。
 */
export async function checkBrain() {
  try {
    const res = await fetch(`${BRAIN}/health`, { method: 'GET' })
    return res.ok
  } catch (_) {
    return false
  }
}
