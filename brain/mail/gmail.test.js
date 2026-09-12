import { test } from 'node:test'
import assert from 'node:assert/strict'
import { idsFromHistory } from './gmail.js'

// ── 增量到底该收哪些 id ──────────────────────────────────────────
//
// 下面这几条 record 不是编的，是 2026-09-11 从 Gmail 真拉回来的形状
// （history.list startHistoryId=550000）。那天丢了两封已发出的信。

test('messagesAdded —— 新来的信，照收', () => {
  assert.deepEqual(
    idsFromHistory([{ id: '1', messagesAdded: [{ message: { id: 'a', labelIds: ['INBOX'] } }] }]),
    ['a'])
})

// 真事（2026-09-10 给 Stacy＋David 的回信）：在 Gmail 里先存草稿、后来才发出去。
// Gmail 对这封只给了四条**裸 records**——只有 messages，一个 messagesAdded 都没有。
// 只认 messagesAdded 的话，这封信从此不存在。
test('裸 messages（只说「这封变过」，不说变了什么）—— 也得收', () => {
  const real = [
    { id: '550514', messages: [{ id: '1a08c020d7e46e56', threadId: '1a08333e0c4c3c07' }] },
    { id: '550521', messages: [{ id: '1a08c020d7e46e56', threadId: '1a08333e0c4c3c07' }] },
  ]
  assert.deepEqual(idsFromHistory(real), ['1a08c020d7e46e56'])
})

// 真事（2026-09-11 回 Biayna 那封）：历史里只有 labelsAdded +SENT，
// 从头到尾没有一次 messagesAdded —— 草稿发出那一刻只是标签翻了个面。
test('labelsAdded +SENT —— 草稿发出那一刻，必须收', () => {
  const real = [
    { id: '550331', labelsAdded: [{ labelIds: ['SENT'], message: { id: '1a090da9903fdee0' } }] },
    { id: '550336', labelsAdded: [{ labelIds: ['INBOX'], message: { id: '1a090da9903fdee0' } }] },
  ]
  assert.deepEqual(idsFromHistory(real), ['1a090da9903fdee0'])
})

test('labelsRemoved 也收 —— DRAFT 被摘掉正是「它发出去了」', () => {
  assert.deepEqual(
    idsFromHistory([{ id: '9', labelsRemoved: [{ labelIds: ['DRAFT'], message: { id: 'b' } }] }]),
    ['b'])
})

// 删掉的照收：拿不到会 404，getMetadata 记一笔 gone 就跳过——那是空转。
// 反过来漏一封就是永远看不见。而且发草稿时 Gmail 可能同时报「删了草稿」，
// 排掉 messagesDeleted 就等于把刚修好的洞又挖开。
test('messagesDeleted 也收 —— 宁可白拿一次 404，不可少一封', () => {
  assert.deepEqual(
    idsFromHistory([{ id: '9', messagesDeleted: [{ message: { id: 'c' } }] }]),
    ['c'])
})

test('同一封在多条 record 里出现只算一次，按首次出现排序', () => {
  assert.deepEqual(
    idsFromHistory([
      { id: '1', messages: [{ id: 'x' }] },
      { id: '2', labelsAdded: [{ labelIds: ['SENT'], message: { id: 'y' } }] },
      { id: '3', messages: [{ id: 'x' }], messagesAdded: [{ message: { id: 'y' } }] },
    ]),
    ['x', 'y'])
})

test('空的、缺字段的、没有 id 的，都不炸也不混进来', () => {
  assert.deepEqual(idsFromHistory(null), [])
  assert.deepEqual(idsFromHistory([]), [])
  assert.deepEqual(idsFromHistory([{ id: '1' }]), [])
  assert.deepEqual(idsFromHistory([{ id: '1', messages: [{ threadId: 't' }] }]), [])
  assert.deepEqual(idsFromHistory([{ id: '1', labelsAdded: [{ labelIds: ['X'] }] }]), [])
})
