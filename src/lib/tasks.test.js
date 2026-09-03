import test from 'node:test'
import assert from 'node:assert/strict'
import { scheduleText, runState, fmtLocal, isFresh } from './tasks.js'

test('排期说成人话；老任务只有 schedule 那列也照旧', () => {
  assert.equal(scheduleText({ run_every: 'week', run_weekday: 1, run_hour: 8 }), '每周一 08:00')
  assert.equal(scheduleText({ run_every: 'day', run_hour: 21 }), '每天 21:00')
  assert.equal(scheduleText({ prompt: '…', run_every: null }), '手动')
  assert.equal(scheduleText({ schedule: 'weekly' }), '每周')
  assert.equal(scheduleText({ schedule: '手动' }), '手动')
  assert.equal(scheduleText({}), null)
})

test('时刻按当地显示', () => {
  // 2026-09-07 15:00Z = 洛杉矶 08:00（PDT）
  assert.equal(fmtLocal('2026-09-07T15:00:00Z', 'America/Los_Angeles'), '9/7 08:00')
})

test('状态：正在跑 > 排上了 > 下次 > 没排期', () => {
  const now = new Date('2026-09-07T15:10:00Z').getTime()
  assert.deepEqual(
    runState({ running_since: '2026-09-07T15:07:00Z', run_now: true, enabled: true, next_run_at: '2026-09-14T15:00:00Z' }, { now }),
    { kind: 'running', text: '正在找……（3 分钟前开始）' })
  assert.equal(runState({ run_now: true, enabled: false }, { now }).kind, 'queued')
  assert.deepEqual(runState({ enabled: true, next_run_at: '2026-09-14T15:00:00Z' }, { now, tz: 'America/Los_Angeles' }),
    { kind: 'next', text: '下次 9/14 08:00' })
  assert.equal(runState({ enabled: false, next_run_at: '2026-09-14T15:00:00Z' }, { now }).kind, 'none')
  assert.match(runState({ running_since: '2026-09-07T12:00:00Z' }, { now }).text, /可能卡住了/)
})

test('「新」= seen_at 明确是 null；种子没这个键不算', () => {
  assert.equal(isFresh({ seen_at: null }), true)
  assert.equal(isFresh({ seen_at: '2026-08-08T00:00:00Z' }), false)
  assert.equal(isFresh({}), false)
})
