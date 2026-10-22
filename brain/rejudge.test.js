import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRejudge, rejudgePrompt } from './rejudge.js'

test('摘出一批重判', () => {
  const raw = `看完了。

[[REJUDGE]] [{"id":"a1","touch":"2027-01-05","why":"她说 \\"I think we should plan on 2027\\"","needs_reply":false,"reply_why":"你已经回过「Sounds great」了"},{"id":"b2","touch":null,"why":null,"needs_reply":true,"reply_why":"他问你能不能三月来"}]`
  const out = parseRejudge(raw)
  assert.equal(out.length, 2)
  assert.equal(out[0].touch, '2027-01-05')
  assert.ok(out[0].why.includes('plan on 2027'))
  assert.equal(out[1].touch, null)
})

test('格式不对 —— 空数组，不猜', () => {
  assert.deepEqual(parseRejudge('我觉得都该催一下'), [])
  assert.deepEqual(parseRejudge('[[REJUDGE]] 不是 json'), [])
})

test('**有日期没出处 —— 整条日期作废**，不许编一个理由', () => {
  const raw = '[[REJUDGE]] [{"id":"a1","touch":"2027-01-05","why":"  ","needs_reply":true}]'
  const out = parseRejudge(raw)
  assert.equal(out[0].touch, null)
  assert.equal(out[0].why, null)
})

test('有出处没日期 —— 也一起作废，理由不会自己响', () => {
  const raw = '[[REJUDGE]] [{"id":"a1","touch":null,"why":"她说明年再说","needs_reply":true}]'
  const out = parseRejudge(raw)
  assert.equal(out[0].touch, null)
  assert.equal(out[0].why, null)
})

test('日期不是 YYYY-MM-DD —— 当没给', () => {
  const raw = '[[REJUDGE]] [{"id":"a1","touch":"明年初","why":"她说明年","needs_reply":true}]'
  assert.equal(parseRejudge(raw)[0].touch, null)
})

test('缺 id 的丢掉，别的照收', () => {
  const raw = '[[REJUDGE]] [{"id":"a1","needs_reply":true},{"touch":"2027-01-05","why":"x"}]'
  const out = parseRejudge(raw)
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'a1')
})

test('没说要不要回 —— 当作要回。漏一封真信比多吵一条坏得多', () => {
  const out = parseRejudge('[[REJUDGE]] [{"id":"a1","touch":null,"why":null}]')
  assert.equal(out[0].needs_reply, true)
})

test('提示词里每个对象都在，带得出 id 和往来', () => {
  const p = rejudgePrompt([
    { id: 'p1', what: 'Paperbark Books 工作坊', who: 'Sarah',
      stage: '发出&提交', touch: '2026-08-12', touch_why: null,
      action: '8-12 前没回音就向 Sarah 跟进',
      mails: [{ at: '2026-08-17', who: 'Sarah', dir: 'in', text: 'plan on 2027' }] },
  ])
  assert.ok(p.includes('p1'))
  assert.ok(p.includes('Paperbark'))
  assert.ok(p.includes('plan on 2027'))
  assert.ok(p.includes('发出&提交'))
  assert.ok(p.includes('[[REJUDGE]]'))
})

test('提示词要说清「模糊的锚点也得落成具体日子」—— 不落地就会飘掉', () => {
  const p = rejudgePrompt([{ id: 'p1', what: 'x', mails: [] }])
  assert.ok(p.includes('plan on 2027'))
  assert.ok(p.includes('2027-01-05'))
  assert.ok(p.includes('circle back next semester'))
  assert.ok(p.includes('LACHSA'))            // 项目自己的反例，别再犯
})
