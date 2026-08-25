// 迁移的真实顺序。**唯一的真相在这儿**,不是文件名的字典序。
//
// 0111–0115 有十支重号(见 supabase/migrations/ORDER.md)。按文件名排,
// 顺序取决于字典序;而其中几支是 create or replace 覆盖同一个函数——
// 排错了就会拿到旧版本的函数体,而且**不报错**。
//
// 下面这个顺序是从生产库的迁移历史时间戳读出来的,是这些迁移真正被
// 应用的次序。合并时把文件改名到位之后,这个列表就可以退化成纯排序。
import { readdirSync } from 'node:fs'

// 重号的那十支:按真实应用时间排。键是文件名,值是它该排的位置。
const 重号真序 = [
  '0111_the_pulse.sql',                          // 08-22 00:27
  '0112_the_pulse_only_counts_real_changes.sql', // 08-22 00:49
  '0113_a_second_workshop_to_offer.sql',         // 08-22 00:55
  '0113_rule_pass_only_writes_real_verdicts.sql',// 08-22 01:46
  '0114_pulse_by_area.sql',                      // 08-22 01:48
  '0115_the_board_stops_hauling_long_text.sql',  // 08-22 01:50
  '0111_needs_reply_is_not_shadowed.sql',        // 08-23 03:09
  '0112_scheduled_sends_get_audited.sql',        // 08-23 03:11
  '0113_retag_replays_in_order.sql',             // 08-23 17:44
  '0114_the_clock_follows_your_last_letter.sql', // 08-23 18:10
  '0116_the_voice_is_data.sql',                  // 未上生产:语气那刀
]

const 重号集 = new Set(重号真序)

// 一次性的**数据修复**,不是 schema。它们修的是他库里某几行历史数据,
// 而且带护栏——「该修 N 条,实际 0 条就整道回滚」。空库上本来就没东西可修,
// 护栏正确地拦下来,于是从零建库必然失败。
//
// 新装(学员那份)要跳过它们:那些数据从来不存在于新库里。
// 这不是绕过失败,是这类迁移**本来就只对一个特定的库有意义**。
const 数据修复 = new Set([
  '0067_work_notes_are_not_the_reply.sql',   // 修 8 条落下的工作稿(156 条里的 8 条)
])

/**
 * 全部迁移文件名,按该跑的顺序。
 * @param {object} opts
 * @param {boolean} opts.fresh  true = 新装,跳过一次性数据修复
 */
export function migrationOrder(dir = 'supabase/migrations', { fresh = false } = {}) {
  const all = readdirSync(dir).filter((f) => f.endsWith('.sql'))
  // 0110 及以前:文件名字典序就是真序(没有重号)
  const 前半 = all.filter((f) => !重号集.has(f)).sort()
  const 漏网 = 重号真序.filter((f) => !all.includes(f))
  if (漏网.length) throw new Error('ORDER 列表里的文件不存在：' + 漏网.join(', '))
  const 全部 = [...前半, ...重号真序]
  return fresh ? 全部.filter((f) => !数据修复.has(f)) : 全部
}

export { 数据修复 as DATA_REPAIRS }
