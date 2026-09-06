import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enqueue, EMPTY, select, key } from './queue.js'
import { deskTabs, deskView, autoOpen } from './desk.js'

const data = {
  pursuits: [{ id: 'p1', title: 'Kunstverein 申请' }],
  contacts: [{ id: 'c1', name: 'Maria Chen' }],
  orgs: [{ org: 'ZKM' }],
}
const q = enqueue(EMPTY, [
  { kind: 'pursuit', id: 'p1' }, { kind: 'contact', id: 'c1' }, { kind: 'org', id: 'ZKM' }, { kind: 'pursuit', id: 'gone' },
])

test('每一格按进桌顺序、带名字；找不到的名字是 null，格子不丢', () => {
  assert.deepEqual(deskTabs(q, data), [
    { k: 'pursuit:p1', kind: 'pursuit', id: 'p1', name: 'Kunstverein 申请' },
    { k: 'contact:c1', kind: 'contact', id: 'c1', name: 'Maria Chen' },
    { k: 'org:ZKM', kind: 'org', id: 'ZKM', name: 'ZKM' },
    { k: 'pursuit:gone', kind: 'pursuit', id: 'gone', name: null },
  ])
})

test('数据还没到也不炸', () => {
  assert.equal(deskTabs(q, {}).length, 4)
  assert.equal(deskTabs(q, {})[0].name, null)
})

test('deskView 给出当前那格的 view；空桌和找不到都是 home', () => {
  assert.deepEqual(deskView(select(q, key('contact', 'c1')), data), { name: 'person', person: data.contacts[0] })
  assert.deepEqual(deskView(select(q, key('org', 'ZKM')), data), { name: 'org', org: data.orgs[0] })
  assert.deepEqual(deskView(select(q, key('pursuit', 'p1')), data), { name: 'pursuit', pursuit: data.pursuits[0] })
  assert.deepEqual(deskView(select(q, key('pursuit', 'gone')), data), { name: 'home' })
  assert.deepEqual(deskView(EMPTY, data), { name: 'home' })
})

test('有未读的自动摆进去；读过的、已经摆过的都不再摆', () => {
  const ps = [{ id: 'a', unread: true }, { id: 'b', unread: false }, { id: 'c', unread: true }]
  assert.deepEqual(autoOpen(ps), [
    { kind: 'pursuit', id: 'a', via: 'update' },
    { kind: 'pursuit', id: 'c', via: 'update' },
  ])
  assert.deepEqual(autoOpen(ps, new Set(['a'])), [{ kind: 'pursuit', id: 'c', via: 'update' }])
  assert.deepEqual(autoOpen(ps, new Set(['a', 'c'])), [])
  assert.deepEqual(autoOpen(), [])
})

test('人也一样：有未读的自动摆进去，跟线混在一排', () => {
  const ps = [{ id: 'p1', unread: true }]
  const cs = [{ id: 'c1', unread: true }, { id: 'c2', unread: false }]
  assert.deepEqual(autoOpen(ps, new Set(), cs), [
    { kind: 'pursuit', id: 'p1', via: 'update' },
    { kind: 'contact', id: 'c1', via: 'update' },
  ])
  assert.deepEqual(autoOpen(ps, new Set(['p1', 'c1']), cs), [])
  // 库还没升级（人那半没有 unread 这一列）也不许炸
  assert.deepEqual(autoOpen(ps, new Set(), [{ id: 'c3' }]), [{ kind: 'pursuit', id: 'p1', via: 'update' }])
})
