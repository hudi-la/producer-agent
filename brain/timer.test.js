import test from 'node:test'
import assert from 'node:assert/strict'
import { directive, timerKey } from './timer.js'

const row = (over = {}) => ({
  state: 'WAITING_REPLY', subject_kind: 'pursuit', subject_id: 'abc-123',
  what: '等平面图和技术对接人', why: null,
  since_at: '2026-08-12T10:00:00Z', due_at: '2026-08-19T10:00:00Z', days_over: 1,
  subject_name: 'CultureHub', ...over,
})

test('WAITING_REPLY 到点：起草 follow-up，但给了「现在不该催」的出口', () => {
  const d = directive(row())
  assert.match(d, /等平面图和技术对接人/)
  assert.match(d, /\[\[LETTER\]\]/)
  assert.match(d, /不该催/)
})

test('NEEDS_REPLY 到点：信息不够就问，不许硬编', () => {
  const d = directive(row({ state: 'NEEDS_REPLY', why: '她在等你点头' }))
  assert.match(d, /她在等你点头/)
  assert.match(d, /别硬编/)
})

test('DEBRIEF：问一句见得怎么样，不带信封', () => {
  const d = directive(row({ state: 'DEBRIEF' }))
  assert.match(d, /见成了吗/)
  assert.ok(!d.includes('[[LETTER]]'))
})

test('谢信和见面信都用信封起草', () => {
  assert.match(directive(row({ state: 'OWE_THANKS', what: '见到了你经「Weidi」介绍认识的「Biayna」' })), /\[\[LETTER\]\]/)
  assert.match(directive(row({ state: 'OWE_MEETING_NOTE', what: '和「Biayna」meeting 了' })), /48 小时/)
})

test('MEETING_SET 当天早上不动笔——那是通知栏的事', () => {
  assert.equal(directive(row({ state: 'MEETING_SET' })), null)
})

test('钥匙 = state:subject:since 那天；等待换了就是新钥匙', () => {
  assert.equal(timerKey(row()), 'WAITING_REPLY:abc-123:2026-08-12')
  assert.notEqual(timerKey(row()), timerKey(row({ since_at: '2026-08-20T09:00:00Z' })))
})

test('连发三封没回（zone=stopped）：不起草第四封，给别的法子', () => {
  const d = directive(row({ zone: 'stopped', followups: 2, days_over: 4 }))
  assert.ok(!d.includes('[[LETTER]]'))
  assert.match(d, /等平面图和技术对接人/)
  assert.match(d, /3 封/)
  assert.match(d, /电话|换个诉求|先放着/)
})

test('到点但还没连发三封：照旧起草 follow-up', () => {
  assert.match(directive(row({ zone: 'due', followups: 1 })), /\[\[LETTER\]\]/)
})
