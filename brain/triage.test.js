import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTriage, triagePrompt } from './triage.js'

test('摘出一批判定', () => {
  const raw = `我看了这三封。

[[TRIAGE]] [{"id":"a1","needs_reply":true,"not_before":null,"why":"她问你三月能不能来一周，等你答"},{"id":"b2","needs_reply":false,"not_before":null,"why":"「谢谢，回头见」，没有要你答的事"},{"id":"c3","needs_reply":true,"not_before":"2027-01-15","why":"他说 circle back next semester"}]`
  const out = parseTriage(raw)
  assert.equal(out.length, 3)
  assert.equal(out[0].id, 'a1')
  assert.equal(out[0].needs_reply, true)
  assert.equal(out[1].needs_reply, false)
  assert.equal(out[2].not_before, '2027-01-15')
})

test('格式不对 —— 空数组，不猜', () => {
  assert.deepEqual(parseTriage('我觉得都得回。'), [])
  assert.deepEqual(parseTriage('[[TRIAGE]] 不是 json'), [])
  assert.deepEqual(parseTriage(''), [])
  assert.deepEqual(parseTriage(null), [])
})

test('缺字段的那条丢掉，别的照收 —— 一封坏的不带塌一批', () => {
  const raw = '[[TRIAGE]] [{"id":"a1","needs_reply":true,"why":"要答"},{"needs_reply":false,"why":"没 id"}]'
  const out = parseTriage(raw)
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'a1')
  assert.equal(out[0].not_before, null)      // 没给就是 null
})

test('not_before 不是日子的话当没给', () => {
  const raw = '[[TRIAGE]] [{"id":"a1","needs_reply":true,"not_before":"下学期","why":"x"}]'
  assert.equal(parseTriage(raw)[0].not_before, null)
})

test('没说理由也收下，但记明它没说 —— 判定得看得见凭据', () => {
  const raw = '[[TRIAGE]] [{"id":"a1","needs_reply":false,"why":"  "}]'
  assert.equal(parseTriage(raw)[0].why, '（没说理由）')
})

test('不是数组 —— 空数组', () => {
  assert.deepEqual(parseTriage('[[TRIAGE]] {"id":"a1"}'), [])
})

test('提示词里每封信都在，而且带得出 id', () => {
  const p = triagePrompt([
    { id: 'a1', from: 'Sarah', subject: '驻地', body: '三月能来一周吗？', at: '2026-08-16' },
    { id: 'b2', from: 'Tom', subject: 'Re: 谢谢', body: '谢谢，回头见。', at: '2026-08-15' },
  ])
  assert.ok(p.includes('a1'))
  assert.ok(p.includes('b2'))
  assert.ok(p.includes('三月能来一周吗'))
  assert.ok(p.includes('[[TRIAGE]]'))
  assert.ok(p.includes('2'))                 // 说得出这批有几封
})

test('正文太长要截断 —— 一封信不许把整个提示词撑爆', () => {
  const p = triagePrompt([{ id: 'a1', from: 'X', subject: 's', body: '啊'.repeat(5000), at: '2026-08-16' }])
  assert.ok(p.length < 4000)
})
