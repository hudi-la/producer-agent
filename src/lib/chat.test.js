// ownerBody 的尺子：一句话发给谁。
//
// 这支小得可疑，但它挡的是一类静悄悄的错：判岔了不会报错，只会把话
// 存到没有主的地方去，而界面照样显示得好好的。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ownerBody } from './chat.js'

test('三种主人各自的身份证', () => {
  assert.deepEqual(ownerBody('p1'), { pursuit_id: 'p1' })               // 老调用方：字符串 = 机会线
  assert.deepEqual(ownerBody({ kind: 'pursuit', id: 'p2' }), { pursuit_id: 'p2' })
  assert.deepEqual(ownerBody({ kind: 'contact', id: 'c1' }), { contact_id: 'c1' })
  assert.deepEqual(ownerBody({ kind: 'studio', id: 'work' }), { section: 'work' })
})

test('书桌的 id 是栏的 key，可以带冒号', () => {
  assert.deepEqual(ownerBody({ kind: 'studio', id: 'credit:exhibition' }),
                   { section: 'credit:exhibition' })
})
