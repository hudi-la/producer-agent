import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentKey, boxFileKey, withOwner, safeName, boxSafeName } from './storageKeys.js'

test('本机 / 演示没有 owner:key 跟以前一个字不差', () => {
  assert.equal(attachmentKey({ owner: null, pursuitId: 'p1', uuid: 'u-1', name: 'cv.pdf' }), 'p1/u-1-cv.pdf')
  assert.equal(boxFileKey({ owner: undefined, entryId: 'e1', stamp: 1700000000000, name: 'a b.png' }), 'box/e1/1700000000000-a_b.png')
  assert.equal(withOwner('', 'x/y'), 'x/y')
})

test('托管有 owner:owner 在最前面,后面原样', () => {
  assert.equal(attachmentKey({ owner: 'uid-9', pursuitId: 'p1', uuid: 'u-1', name: 'cv.pdf' }), 'uid-9/p1/u-1-cv.pdf')
  assert.equal(boxFileKey({ owner: 'uid-9', entryId: 'e1', stamp: 5, name: '简历.pdf' }), 'uid-9/box/e1/5-简历.pdf')
})

test('文件名清洗:附件去中文换 -,盒子留中文换 _', () => {
  assert.equal(safeName('简历 final (1).pdf'), 'final-1-.pdf')
  assert.equal(safeName(''), 'file')
  assert.equal(boxSafeName('简历 final (1).pdf'), '简历_final_1_.pdf')
})
