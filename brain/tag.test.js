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

// 2026-08-18 反过来了：**正文住进标记里之后，剁尾巴 = 丢整封信。**
// 信封里带着信的 body，表单信封里带着每一格的答案 —— 解析失败还照剁的话，
// 他看到的是一句「我起了一版，你看看」，下面什么都没有。
// 留一行难看的 [[FORM]] {" 你看得见；消失的东西你连问都不知道该问什么。
test('解析失败就一个字都不剁——尾巴里可能装着整封信', () => {
  const body = '这是它想了半天写出来的东西。\n\n第二段。'
  for (const tail of ['[[FORM]]', '[[FORM]] {', '[[FORM]] {"fields":[{"q":']) {
    const src = `${body}\n\n${tail}`
    const { clean, data } = takeTag(src, 'FORM')
    assert.equal(clean, src.trim(), `断在 ${tail} 时东西被丢了`)
    assert.equal(data, null)
  }
})

test('解析成功才剁——那时候正文已经安全地在 data 里了', () => {
  const { clean, data } = takeTag('前面的话。\n\n[[FORM]] {"fields":[]}', 'FORM')
  assert.equal(clean, '前面的话。')
  assert.deepEqual(data, { fields: [] })
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
