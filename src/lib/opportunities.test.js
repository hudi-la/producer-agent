import test from 'node:test'
import assert from 'node:assert/strict'
import {
  laneOf, sortPool, counts, latestRound, whenText, checkedText,
  STATUS_LABEL, REACH_LABEL, staleOpen,
} from './opportunities.js'

const row = (o) => ({ title: 'X', status: 'unknown', fit_stars: null, reach: null, ...o })

test('一行算哪一格：捡过的和划掉的沉底，但都还在', () => {
  assert.equal(laneOf(row({ status: 'open' })), 'open')
  assert.equal(laneOf(row({ status: 'closed' })), 'watching')
  assert.equal(laneOf(row({ status: 'unknown' })), 'watching')
  assert.equal(laneOf(row({ status: 'open', pursuit_id: 'p1' })), 'onboard')
  // 划掉压过一切：划掉的开着的机会也不该再冒到最前面
  assert.equal(laneOf(row({ status: 'open', pursuit_id: 'p1', dropped_at: 'now' })), 'dropped')
})

test('排序：开着的最前，然后星多的、够得着的、截止近的', () => {
  const rows = [
    row({ title: '关注中三星', status: 'closed', fit_stars: 3 }),
    row({ title: '开 · 二星', status: 'open', fit_stars: 2, reach: 'realistic' }),
    row({ title: '开 · 三星 · 悬', status: 'open', fit_stars: 3, reach: 'stretch' }),
    row({ title: '开 · 三星 · 够得着', status: 'open', fit_stars: 3, reach: 'realistic' }),
    row({ title: '已在看板', status: 'open', fit_stars: 3, pursuit_id: 'p1' }),
    row({ title: '划掉了', status: 'open', fit_stars: 3, dropped_at: 'x' }),
  ]
  assert.deepEqual(sortPool(rows).map((r) => r.title), [
    '开 · 三星 · 够得着', '开 · 三星 · 悬', '开 · 二星', '关注中三星', '已在看板', '划掉了',
  ])
})

test('没查到 ≠ 不行：够得着那一列四档分得开', () => {
  assert.equal(REACH_LABEL.unknown, '没查到')
  assert.equal(REACH_LABEL.longshot, '多半白投')
  assert.notEqual(REACH_LABEL.unknown, REACH_LABEL.longshot)
})

test('从来没查过要说出来，不许空着', () => {
  assert.equal(checkedText(row({})), '没查过')
  assert.equal(checkedText(row({ checked_at: '2026-09-07T10:00:00Z' })), '9/7 查过')
})

test('截止那一格：开着的说截止，关着的说什么时候开；算不出日子就用原话', () => {
  assert.equal(whenText(row({ status: 'open', deadline_at: '2026-09-28' })), '截止 9/28')
  assert.equal(whenText(row({ status: 'open', deadline: 'rolling basis' })), 'rolling basis')
  assert.equal(whenText(row({ status: 'open' })), '没记截止')
  assert.equal(whenText(row({ status: 'closed', opens_at: '2026-11-01' })), '约 11/1 开')
  assert.equal(whenText(row({ status: 'closed', deadline_at: '2026-06-01' })), '上轮 6/1')
  assert.equal(STATUS_LABEL.unknown, '没查过')
})

test('每一格几行', () => {
  const c = counts([
    row({ status: 'open' }), row({ status: 'open' }),
    row({ status: 'closed' }),
    row({ pursuit_id: 'p' }), row({ dropped_at: 'x' }),
  ])
  assert.deepEqual(c, { all: 5, open: 2, watching: 1, onboard: 1, dropped: 1 })
})

test('最近那一轮是哪天', () => {
  assert.equal(latestRound([
    row({ noted_round: '2026-09-07' }), row({ noted_round: '2026-08-31' }), row({}),
  ]), '2026-09-07')
  assert.equal(latestRound([row({})]), null)
})

test('标着开着但截止日过了 = 旧状态，界面不许说它开着', () => {
  const today = '2026-09-03'
  assert.equal(staleOpen(row({ status: 'open', deadline_at: '2026-06-01' }), today), true)
  assert.equal(staleOpen(row({ status: 'open', deadline_at: '2026-09-28' }), today), false)
  assert.equal(staleOpen(row({ status: 'open', deadline: 'rolling' }), today), false)   // 算不出日子就不判
  assert.equal(staleOpen(row({ status: 'closed', deadline_at: '2026-06-01' }), today), false)
})
