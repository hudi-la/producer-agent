import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadJudgments, lintJudgments, judgmentsFor, _setDocs, setJudgmentsEnabled, useJudgmentsDir, judgeWithFallback } from './judgments.js'
import { cellFor, JUDGMENTS_SLOT } from './judge.js'

const fact = { subject_name: 'X', kind: 'email', role: 'org', content: 'hi', recent: [] }

test('文件名映射到事件;空文件不算;没有的文件为空', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-j-'))
  writeFileSync(join(dir, '对方来信.md'), '投递类我等 30 天再问')
  writeFileSync(join(dir, '手记.md'), '   \n')
  writeFileSync(join(dir, '随便.md'), '不认的文件')
  const { docs } = loadJudgments(dir)
  assert.deepEqual(docs, { THEIR_LETTER: '投递类我等 30 天再问' })
  rmSync(dir, { recursive: true, force: true })
})

test('lint:改字段的句子被点名,别的不点', () => {
  assert.deepEqual(lintJudgments('a.md', '拿不准就算要回\n请增加一个字段 urgency\nwait_days 改成 10'), ['a.md 第 2 行:字段由系统定,这句不生效'])
  assert.deepEqual(lintJudgments('b.md', 'wait_days 一般给 14 天'), [])
})

test('judgmentsFor:全部 + 那一格;关着为空', () => {
  _setDocs({ '*': '总的', THEIR_LETTER: '来信的' })
  assert.match(judgmentsFor('THEIR_LETTER'), /总的[\s\S]*来信的/)
  assert.match(judgmentsFor('NOTE'), /总的/); assert.doesNotMatch(judgmentsFor('NOTE'), /来信的/)
  setJudgmentsEnabled(false); assert.equal(judgmentsFor('THEIR_LETTER'), ''); setJudgmentsEnabled(true)
})

test('cellFor 的 ask:判据拼在收尾之前,骨架的字段规格仍是最后一段;没判据时占位符消失', () => {
  _setDocs({ THEIR_LETTER: '我的口味' })
  const t = cellFor('IDLE', 'THEIR_LETTER').ask(fact, {})
  assert.ok(!t.includes(JUDGMENTS_SLOT), '占位符换掉了')
  const i = t.indexOf('我的口味'), j = t.indexOf('[[TAG]]')
  assert.ok(i > 0 && j > i, '判据在 [[TAG]] 规格之前')
  _setDocs({})
  const u = cellFor('IDLE', 'THEIR_LETTER').ask(fact, {})
  assert.ok(!u.includes(JUDGMENTS_SLOT) && !u.includes('我的判据'))
})

test('useJudgmentsDir 读盘并记 lint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-j-'))
  writeFileSync(join(dir, '全部.md'), '宁可多提醒\n删掉 gist')
  const logs = []; useJudgmentsDir(dir, { log: (s) => logs.push(s) })
  assert.match(judgmentsFor('NOTE'), /宁可多提醒/)
  assert.ok(logs.some((l) => l.includes('第 2 行')))
  useJudgmentsDir(null); _setDocs({})
  rmSync(dir, { recursive: true, force: true })
})

test('judgeWithFallback:判出来就用;带判据没判出来 → 不带判据再判一次,并说明', async () => {
  _setDocs({ '*': '口味' }); setJudgmentsEnabled(true)
  let calls = 0; const logs = []
  const run = async () => { calls++; return calls === 1 ? '胡说' : '[[TAG]] {"gist":"ok"}' }
  const parse = (t) => (t.startsWith('[[TAG]]') ? { gist: 'ok' } : null)
  const r = await judgeWithFallback(run, parse, { log: (m) => logs.push(m), what: 'X' })
  assert.deepEqual(r, { tag: { gist: 'ok' }, fellBack: true }); assert.equal(calls, 2); assert.ok(logs[0].includes('全部.md'))
  _setDocs({})
  calls = 0; const r2 = await judgeWithFallback(run, parse, {})
  assert.equal(r2.tag, null); assert.equal(calls, 1)      // 没判据就不回退——回退没意义
})
