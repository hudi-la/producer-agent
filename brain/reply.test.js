import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldReply } from './reply.js'

const t = (text) => ({ type: 'text', text })
const use = (name = 'WebSearch') => ({ type: 'tool_use', name })

test('没动过工具：说的话原样就是回答', () => {
  const r = foldReply([t('算，但不是你以为的那一层。'), t('第二段。')])
  assert.equal(r.text, '算，但不是你以为的那一层。\n第二段。')
  assert.deepEqual(r.notes, [])
  assert.equal(r.recovered, false)
})

test('动工具之前说的话是工作稿，不是回答', () => {
  const r = foldReply([
    t("I'll start by loading the web tools."), use(),
    t('Excellent — MAT has a PhD Dissertations page. Let me fetch it.'), use(),
    t('我把两个人都挖了一遍。'),
  ])
  assert.equal(r.text, '我把两个人都挖了一遍。')
  assert.deepEqual(r.notes, [
    "I'll start by loading the web tools.",
    'Excellent — MAT has a PhD Dissertations page. Let me fetch it.',
  ])
})

test('UCSB 那条的形状：一坨英文工作稿 + 结尾中文回答', () => {
  const 工作稿 = ['## Verdict', '## CRITICAL DELIVERABLE — most recent verifiable thing']
  const r = foldReply([
    t("I'll research this systematically."), use(), use(),   // 连着动两次工具，中间没说话
    t(工作稿.join('\n')), use(),
    t('我把两个人都挖了一遍，先说一件会改这条线性质的事。'),
  ])
  assert.equal(r.text, '我把两个人都挖了一遍，先说一件会改这条线性质的事。')
  assert.equal(r.notes.length, 2)
  assert.ok(r.notes[1].includes('CRITICAL DELIVERABLE'))
  // 给人看的那段里，一个字的工作稿都不许剩
  assert.ok(!r.text.includes("I'll"))
  assert.ok(!r.text.includes('CRITICAL DELIVERABLE'))
})

test('一个 assistant 消息里 text 和 tool_use 同框，text 在前 = 工作稿', () => {
  const r = foldReply([t('Let me check that.'), use(), t('查完了，是这样。')])
  assert.equal(r.text, '查完了，是这样。')
  assert.deepEqual(r.notes, ['Let me check that.'])
})

test('连着动工具、中间一个字没说，不会攒出空段', () => {
  const r = foldReply([use(), use(), use(), t('结论。')])
  assert.equal(r.text, '结论。')
  assert.deepEqual(r.notes, [])
})

test('兜底：最后一轮没说话，拿最后一段工作稿顶上，并标出来', () => {
  const r = foldReply([t('第一段工作稿'), use(), t('最后查到的东西'), use()])
  assert.equal(r.text, '最后查到的东西')
  assert.deepEqual(r.notes, ['第一段工作稿'])
  assert.equal(r.recovered, true, '顶上来的必须标出来，不能假装是正常回答')
})

test('真的一个字都没有就是空 —— 由调用方去报错，这儿不编', () => {
  assert.equal(foldReply([use(), use()]).text, '')
  assert.equal(foldReply([]).text, '')
  assert.equal(foldReply(null).text, '')
})

test('thinking 之类的块不算数，也不当分段依据', () => {
  const r = foldReply([
    { type: 'thinking', thinking: '想一想' },
    t('回答。'),
    { type: 'thinking', thinking: '再想想' },
  ])
  assert.equal(r.text, '回答。')
  assert.deepEqual(r.notes, [])
})

test('空 text 块不会在回答里凭空加换行', () => {
  const r = foldReply([t(''), t('回答。'), t('')])
  assert.equal(r.text, '回答。')
})
