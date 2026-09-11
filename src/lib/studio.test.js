// 「他现在在写哪个」怎么算出来的。
//
// 焦点靠他**本来就在做的事**定：展开着哪几条就是哪几条。没有新按钮、
// 没有「选中」这个动作要他学。所以这支盯的是：展开集合 → 报给脑子的那份名单。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { focusOf } from './studio.js'

const SEC = {
  key: 'work', label: '作品',
  items: [{ id: 'a', title: '花园' }, { id: 'b', title: '海' }, { id: 'c', title: '山' }],
}

test('展开着的那几条带 id 报上去，顺序跟栏里一致', () => {
  const f = focusOf(SEC, new Set(['c', 'a']))
  assert.equal(f.label, '作品')
  assert.equal(f.count, 3)
  assert.deepEqual(f.open, [{ id: 'a', title: '花园' }, { id: 'c', title: '山' }])
})

test('一条没展开：open 是空数组，不是 undefined', () => {
  assert.deepEqual(focusOf(SEC, new Set()).open, [])
})

test('「关于你」那一格没有条目，count 是 0，不炸', () => {
  const f = focusOf({ key: 'about', label: '关于你', about: true }, new Set())
  assert.equal(f.count, 0)
  assert.deepEqual(f.open, [])
})

test('展开着的条目已经不在这一栏里了（库变了），不许漏进名单', () => {
  const f = focusOf(SEC, new Set(['a', '这条已经没了']))
  assert.deepEqual(f.open, [{ id: 'a', title: '花园' }])
})

test('没有栏就没有焦点——别报一个空壳给脑子', () => {
  assert.equal(focusOf(null, new Set()), null)
})

test('没标题的条目不报一个空书名号上去', () => {
  const f = focusOf({ key: 'work', label: '作品', items: [{ id: 'x', title: '' }] }, new Set(['x']))
  assert.deepEqual(f.open, [{ id: 'x', title: '（未命名）' }])
})
