// 「流水」页的读面：办完的事有自己的一页。
//
// 他要的心安（「它自己发现这事办到了」）不做成提醒 —— 那会复发
// 「存档假装成提醒」的病。做成一页流水：想看的时候伸手可得（pull），
// 不来敲你（push）。一行都不新存，全从事实现算（pa_ledger，0105）。

import { supa, DB_CONFIGURED } from './backends.js'

export async function loadLedger(days = 14) {
  if (!DB_CONFIGURED) return { days: [], summary: null, reason: 'no-config' }
  const { data, error } = await supa.rpc('pa_ledger', { p_days: days })
  if (error) return { days: [], summary: null, reason: error.message }

  // 按当地的日子分组，新的在上
  const byDay = new Map()
  for (const r of data || []) {
    if (!byDay.has(r.day)) byDay.set(r.day, [])
    byDay.get(r.day).push(r)
  }

  // 本周一行小计 —— 第一版克制：数数就够，连击徽章那类等用了两周再说
  const week = (data || []).filter((r) => Date.now() - new Date(r.at) < 7 * 86400000)
  const n = (k) => week.filter((r) => r.kind === k).length
  const summary = {
    sent: n('sent'), got: n('got'),
    closed: n('wait_close'), opened: n('wait_open'),
    notes: n('note'), fairwind: n('fairwind'),
  }

  return { days: [...byDay.entries()], summary, reason: null }
}

/** 每种事一个词 —— 行首的小标。 */
export const KIND_LABEL = {
  sent: '发出', got: '收到', note: '记了一笔',
  wait_open: '开始等', wait_close: '关掉一个等待', fairwind: 'Fairwind',
}
