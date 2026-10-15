import test from 'node:test'
import assert from 'node:assert/strict'
import { scheduleText, runState, fmtLocal, isFresh, groupTasks } from './tasks.js'

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

test('分批搜索暂停时显示续跑而非普通下次排期；再次触发显示排队', () => {
  const task = { config: { scout_progress: { status: 'paused' } }, enabled: true, next_run_at: '2026-09-14T15:00:00Z' }
  assert.equal(runState(task, { tz: 'America/Los_Angeles' }).kind, 'paused')
  assert.match(runState(task, { tz: 'America/Los_Angeles' }).text, /9\/14 08:00/)
  assert.equal(runState({ ...task, run_now: true }).kind, 'queued')
})

test('「新」= seen_at 明确是 null；种子没这个键不算', () => {
  assert.equal(isFresh({ seen_at: null }), true)
  assert.equal(isFresh({ seen_at: '2026-08-08T00:00:00Z' }), false)
  assert.equal(isFresh({}), false)
})

test('分四组：只有带提示词的那一条是真的定时任务', () => {
  const { timed, ran, origins, notYet } = groupTasks([
    { name: '每周找机会', prompt: '…', run_every: 'week' },
    { name: '树皮书', type: 'institution_monitor', last_run_at: '2026-08-03T00:00:00Z', last_result: '核实 22 家' },
    { name: '模特经纪', type: 'agency_scout', last_result: '核实 7 家' },
    { name: '你自己丢的', type: 'manual' },
    { name: '盯梢机构', type: 'institution_monitor', last_result: '未接' },
    { name: '邮箱进来的机会', type: 'email_watch', last_result: '未接' },
  ])
  assert.deepEqual(timed.map((t) => t.name), ['每周找机会'])
  assert.deepEqual(ran.map((t) => t.name), ['树皮书', '模特经纪'])
  assert.deepEqual(origins.map((t) => t.name), ['你自己丢的'])
  assert.deepEqual(notYet.map((t) => t.name), ['盯梢机构', '邮箱进来的机会'])
})
