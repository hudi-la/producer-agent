import test from 'node:test'
import assert from 'node:assert/strict'
import { extractForm, fieldKey } from './form.js'

const wrap = (o) => `正文。\n\n[[FORM]] ${JSON.stringify(o)}`

test('摘出一张表：标题、题目、答案、字数闸', () => {
  const { clean, form } = extractForm(wrap({
    title: 'Solitude 驻地申请',
    fields: [
      { q: 'Artist statement', words: [50, 100], a: 'I work with…' },
      { q: '项目描述', chars: [1000, 1500], a: '这个项目…' },
    ],
  }))
  assert.equal(clean, '正文。')
  assert.equal(form.title, 'Solitude 驻地申请')
  assert.equal(form.fields.length, 2)
  assert.equal(form.fields[0].q, 'Artist statement')
  assert.deepEqual(form.fields[0].words, [50, 100])
  assert.equal(form.fields[0].a, 'I work with…')
  assert.deepEqual(form.fields[1].chars, [1000, 1500])
})

test('没有标记就当没有，正文原样交出', () => {
  const { clean, form } = extractForm('就是一段普通回复。')
  assert.equal(clean, '就是一段普通回复。')
  assert.equal(form, null)
})

test('标记坏了不能连累正文', () => {
  const { clean, form } = extractForm('正文在这儿。\n\n[[FORM]] {坏掉的')
  assert.equal(clean, '正文在这儿。')
  assert.equal(form, null)
})

test('一格都没有的表不算表——空表在界面上是一张点了没反应的卡', () => {
  assert.equal(extractForm(wrap({ title: 'x', fields: [] })).form, null)
  assert.equal(extractForm(wrap({ title: 'x' })).form, null)
})

test('没题目的格子丢掉，别的格子照留', () => {
  const { form } = extractForm(wrap({
    fields: [{ q: '  ', a: '孤儿答案' }, { q: '真题目', a: '真答案' }],
  }))
  assert.equal(form.fields.length, 1)
  assert.equal(form.fields[0].q, '真题目')
})

test('表名没给有个兜底的，不留 null 给界面', () => {
  assert.equal(extractForm(wrap({ fields: [{ q: '题' }] })).form.title, '未命名表单')
})

test('答案没写就是空串——这一格等你自己填，不是坏了', () => {
  const { form } = extractForm(wrap({ fields: [{ q: '题' }] }))
  assert.equal(form.fields[0].a, '')
})

test('闸写坏了只丢闸，不丢格子', () => {
  const { form } = extractForm(wrap({
    fields: [
      { q: '甲', words: '五十到一百', a: 'x' },
      { q: '乙', chars: [100], a: 'y' },
      { q: '丙', words: [100, 50], a: 'z' },
    ],
  }))
  assert.equal(form.fields.length, 3)
  assert.equal(form.fields[0].words, undefined)
  assert.equal(form.fields[1].chars, undefined)
  assert.equal(form.fields[2].words, undefined, '下限比上限大是写反了，不是一条闸')
})

test('上限型的闸（只给上限）认', () => {
  const { form } = extractForm(wrap({ fields: [{ q: '题', words: [0, 300] }] }))
  assert.deepEqual(form.fields[0].words, [0, 300])
})

test('每一格有个稳定的 key —— 答案按它存，重收一次不能错位', () => {
  const a = extractForm(wrap({ fields: [{ q: '题目一' }, { q: '题目二' }] })).form
  const b = extractForm(wrap({ fields: [{ q: '题目二' }, { q: '题目一' }] })).form
  assert.equal(a.fields[0].key, b.fields[1].key, '同一个题目换了位置也该是同一个 key')
  assert.notEqual(a.fields[0].key, a.fields[1].key)
})

test('key 只认题目本身，前后空格和大小写不算两道题', () => {
  assert.equal(fieldKey('  Artist Statement '), fieldKey('artist statement'))
})
