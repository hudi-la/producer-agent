import test from 'node:test'
import assert from 'node:assert/strict'
import { takeTag, clean1 } from './tag.js'

test('摘走标记，正文里不留', () => {
  const { clean, data } = takeTag('正文。\n\n[[FORM]] {"a":1}', 'FORM')
  assert.equal(clean, '正文。')
  assert.deepEqual(data, { a: 1 })
})

test('没有标记就原样交出', () => {
  const { clean, data } = takeTag('就是一段话。', 'FORM')
  assert.equal(clean, '就是一段话。')
  assert.equal(data, null)
})

test('标记只写了一半，正文照样干净——这是这儿最要紧的一条', () => {
  const body = '这是它想了半天写出来的东西。\n\n第二段。'
  for (const tail of ['[[FORM]]', '[[FORM]] {', '[[FORM]] {"fields":[{"q":']) {
    const { clean, data } = takeTag(`${body}\n\n${tail}`, 'FORM')
    assert.equal(clean, body, `断在 ${tail} 时正文被咬了`)
    assert.equal(data, null)
  }
})

test('认名字：LETTER 的标记不会被当成 FORM', () => {
  const { clean, data } = takeTag('正文。\n\n[[LETTER]] {"to":"a@b.c"}', 'FORM')
  assert.equal(clean, '正文。\n\n[[LETTER]] {"to":"a@b.c"}')
  assert.equal(data, null)
})

test('正文里提过一次，取最后那个', () => {
  const { data } = takeTag('前面提过 [[FORM]] {"a":0} 这种。\n\n[[FORM]] {"a":9}', 'FORM')
  assert.deepEqual(data, { a: 9 })
})

test('clean1：空白一律变 null', () => {
  assert.equal(clean1('  '), null)
  assert.equal(clean1(null), null)
  assert.equal(clean1(' 有字 '), '有字')
})
