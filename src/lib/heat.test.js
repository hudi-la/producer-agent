import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weeksOf, monthMarks, levelOf, dayKey, STEPS } from './heat.js'

const T = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12) }

test('每一列都是七格，周一在最上面', () => {
  const w = weeksOf(new Map(), 30, T('2026-08-22'))   // 8/22 是周六
  for (const col of w) assert.equal(col.length, 7)
  // 最后一列里 today 应该落在周六那一格（下标 5）
  const last = w.at(-1)
  assert.equal(last[5].day, '2026-08-22')
  assert.equal(last[6], null)                          // 周日还没到，是空位
})

// 这条守的是时区：东八区凌晨用 toISOString 会退回前一天，
// 整张图跟着错一格 —— 「今天」画到昨天那一格上。
test('日子按本地时间算，不按 UTC', () => {
  assert.equal(dayKey(new Date(2026, 7, 22, 0, 30)), '2026-08-22')
  assert.equal(dayKey(new Date(2026, 7, 22, 23, 30)), '2026-08-22')
})

test('范围就是 span 天，一天不多一天不少', () => {
  const w = weeksOf(new Map(), 14, T('2026-08-22'))
  const days = w.flat().filter(Boolean).map((c) => c.day)
  assert.equal(days.length, 14)
  assert.equal(days[0], '2026-08-09')
  assert.equal(days.at(-1), '2026-08-22')
})

test('件数落到对应的格子上', () => {
  const counts = new Map([['2026-08-20', 7], ['2026-08-22', 1]])
  const cells = weeksOf(counts, 14, T('2026-08-22')).flat().filter(Boolean)
  assert.equal(cells.find((c) => c.day === '2026-08-20').n, 7)
  assert.equal(cells.find((c) => c.day === '2026-08-21').n, 0)
})

// 门槛写死不缩放：缩放的话「今天最多 3 件」会跟「今天最多 22 件」染成一样深，
// 两周后回头看就读错了自己。
test('深浅分四档，门槛是固定的', () => {
  assert.equal(levelOf(0), 0)
  assert.equal(levelOf(1), 1)
  assert.equal(levelOf(STEPS[0]), 2)
  assert.equal(levelOf(STEPS[1]), 3)
  assert.equal(levelOf(STEPS[2]), 4)
  assert.equal(levelOf(999), 4)
})

test('月份标只在换月那一列出现一次', () => {
  const marks = monthMarks(weeksOf(new Map(), 60, T('2026-08-22')))
  const got = marks.filter(Boolean)
  assert.deepEqual(got, ['6月', '7月', '8月'])
})
