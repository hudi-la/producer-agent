// 迁移顺序 = 文件名字典序。2026-09-16 合并时重号已清零（见 supabase/migrations/ORDER.md）。
// 这个文件留下的只有一件事:哪些是一次性数据修复,新装要跳过。
import { readdirSync } from 'node:fs'

// 一次性的**数据修复**,不是 schema。它们修的是他库里某几行历史数据,
// 而且带护栏——「该修 N 条,实际 0 条就整道回滚」。空库上本来就没东西可修,
// 护栏正确地拦下来,于是从零建库必然失败。
//
// 新装(学员那份)要跳过它们:那些数据从来不存在于新库里。
// 这不是绕过失败,是这类迁移**本来就只对一个特定的库有意义**。
const 数据修复 = new Set([
  '0067_work_notes_are_not_the_reply.sql',   // 修 8 条落下的工作稿(156 条里的 8 条)
  '0113_a_second_workshop_to_offer.sql',     // 他个人的 offer 条目(血肉,不是骨架)——学员的新库里不该有他的档案
])

/**
 * 全部迁移文件名,按该跑的顺序。
 * @param {object} opts
 * @param {boolean} opts.fresh  true = 新装,跳过一次性数据修复
 */
export function migrationOrder(dir = 'supabase/migrations', { fresh = false } = {}) {
  const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const nums = all.map((f) => f.slice(0, 4))
  const dup = nums.find((n, i) => nums.indexOf(n) !== i)
  if (dup) throw new Error(`迁移重号:${dup}。一条线递增,不许再撞。`)
  return fresh ? all.filter((f) => !数据修复.has(f)) : all
}

export { 数据修复 as DATA_REPAIRS }
