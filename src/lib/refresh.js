// 「更新最新信息」的前端侧：一条线一炮，串行由 App 驱动。
//
// 为什么前端驱动循环而不是 brain 一把全跑：进度（更新中 3/40）要实时给人看，
// 单线失败要能跳过接着跑——都是循环在谁手里的问题。brain 只管「一条线怎么更新」。
import { BRAIN, brainFetch } from './backends.js'

export async function refreshPursuit(id) {
  const r = await brainFetch(`${BRAIN}/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pursuit_id: id }),
  })
  const out = await r.json().catch(() => null)
  if (!r.ok || !out || out.error) throw new Error(out?.error || `HTTP ${r.status}`)
  return out
}
