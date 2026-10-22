import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkRules, itemProgress, formProgress, countWords } from './rules.js'

const F = (fields) => ({ fields })
const A = (answers) => ({ answers })

test('逐格闸：每一格算自己的词数', () => {
  const rules = F([
    { key: 'a', q: 'Artist statement', words: [50, 100] },
    { key: 'b', q: '项目描述', chars: [10, 20] },
  ])
  const meta = A({ a: 'word '.repeat(60).trim(), b: '一二三四五六七八九十一二' })
  const { checks, allOk } = checkRules(rules, null, meta)
  assert.equal(checks.length, 2)
  assert.equal(checks[0].ok, true)
  assert.equal(checks[1].ok, true)
  assert.equal(allOk, true)
})

test('某一格超了，整张表就定不了稿', () => {
  const rules = F([{ key: 'a', q: '题', words: [0, 10] }])
  const { checks, allOk } = checkRules(rules, null, A({ a: 'word '.repeat(30) }))
  assert.equal(allOk, false)
  assert.equal(checks[0].ok, false)
  assert.match(checks[0].label, /30 词/)
})

test('空着的格子不算过——「还没填」和「填了但超了」得分得出来', () => {
  const rules = F([{ key: 'a', q: '题', words: [0, 100] }])
  const { checks, allOk } = checkRules(rules, null, A({}))
  assert.equal(allOk, false)
  assert.equal(checks[0].ok, false)
  assert.match(checks[0].detail, /还没填/)
})

test('只有空格的答案也算没填', () => {
  const { allOk } = checkRules(F([{ key: 'a', q: '题' }]), null, A({ a: '   \n ' }))
  assert.equal(allOk, false)
})

test('没有字数闸的格子，填了就算过', () => {
  const { checks, allOk } = checkRules(F([{ key: 'a', q: '题' }]), null, A({ a: '填了' }))
  assert.equal(allOk, true)
  assert.equal(checks[0].detail, null)
})

test('每条 check 带得回题目和 key —— 界面要靠它把闸挂到对应那一格下面', () => {
  const { checks } = checkRules(F([{ key: 'k1', q: 'Artist statement' }]), null, A({ a: '' }))
  assert.equal(checks[0].key, 'field:k1')
  assert.equal(checks[0].q, 'Artist statement')
  assert.equal(checks[0].field, true)
})

test('上限型（下限 0）不会因为写得短就不过', () => {
  const { allOk } = checkRules(F([{ key: 'a', q: '题', words: [0, 300] }]), null, A({ a: '短' }))
  assert.equal(allOk, true)
})

test('formProgress：过了几格 / 一共几格', () => {
  const rules = F([
    { key: 'a', q: '甲', words: [0, 5] },
    { key: 'b', q: '乙', words: [0, 5] },
    { key: 'c', q: '丙' },
  ])
  assert.deepEqual(formProgress(rules, A({ a: 'one two', c: '填了' })), { hit: 2, total: 3 })
  assert.equal(formProgress({}, {}), null)
})

test('老的那几种闸一条都没动', () => {
  assert.equal(checkRules({ chars: [1, 10] }, '12345', {}).allOk, true)
  assert.equal(checkRules({ chars: [1, 3] }, '12345', {}).allOk, false)
  assert.equal(checkRules({ items: ['甲', '乙'] }, null, { done: ['甲'] }).allOk, false)
  assert.deepEqual(itemProgress({ items: ['甲', '乙'] }, { done: ['甲'] }), { hit: 1, total: 2 })
  assert.equal(checkRules({}, '', {}, { needsBody: true }).allOk, false)
  assert.equal(countWords('one two  three'), 3)
})
