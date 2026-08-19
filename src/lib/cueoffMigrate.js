import { supa, DB_CONFIGURED } from './backends.js'

// 旧的 localStorage['pa_cue_off'] 迁进库，迁完清掉。
//
// **已经关掉的那些不许在这次改动里悄悄复活。** 你上周关掉的那条，
// 升级之后又冒出来 —— 那是「你以为处理过了，其实系统忘了」，
// 跟红点撒谎是同一件事。
//
// 旧键：`${contactId}|${via}|${at}`（那时候只有人，没有机会线）
// 新键：`${subject_kind}|${subject_id}|${via}|${at}`
// 所以迁的时候统统当 contact —— 那时候本来也只有人。
//
// 设计稿：docs/specs/2026-08-18-notifications-design.md 第九节

const KEY = 'pa_cue_off'
const DONE = 'pa_cue_off_migrated'

export async function migrateCueOff() {
  if (!DB_CONFIGURED) return 0            // 没连库就别清本地，等连上了再迁
  try {
    if (localStorage.getItem(DONE)) return 0
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    const keys = Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []
    let n = 0
    for (const k of keys) {
      const [id, via, at] = k.split('|')
      if (!id || !via || !at) continue     // 存坏了的跳过，不拦路
      const { data } = await supa.rpc('pa_mark_cue', {
        p_kind: 'contact', p_id: id, p_via: via, p_at: at, p_mark: 'off',
      })
      if (data) n++
    }
    // **迁完才清。** 中途失败下次开机重来一遍（RPC 是 upsert，重跑安全）。
    localStorage.setItem(DONE, '1')
    localStorage.removeItem(KEY)
    return n
  } catch (_) {
    return 0                               // 迁不动最多是几条重新出现，不丢东西
  }
}
