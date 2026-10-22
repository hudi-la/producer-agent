import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickAddresses } from './carry.js'

const known = new Set(['stacy@culturehub.org', 'jharding@huntington.org', 'residency@culturehub.org'])

// ── 把门 ────────────────────────────────────────────────────────
// pa_mail_promote 那个口子不认识「认过没有」——拿 noreply@github.com 去问
// 它照样返回 33 行。所以门在这儿，而且必须是这儿唯一的一道。

test('没认过的地址一个都不搬', () => {
  const { take } = pickAddresses(
    ['noreply@github.com', 'stacy@culturehub.org', 'no-reply@substack.com'], known)
  assert.deepEqual(take, ['stacy@culturehub.org'])
})

test('大小写不算另一个地址', () => {
  const { take } = pickAddresses(['Stacy@CultureHub.org', ' JHARDING@huntington.org '], known)
  assert.deepEqual(take.sort(), ['jharding@huntington.org', 'stacy@culturehub.org'])
})

test('同一个地址来了三封，也只搬一次', () => {
  const t = ['stacy@culturehub.org', 'stacy@culturehub.org', 'stacy@culturehub.org']
  assert.equal(pickAddresses(t, known).take.length, 1)
})

test('机构共享信箱也算认过的——它不是人，但登记过', () => {
  assert.deepEqual(pickAddresses(['residency@culturehub.org'], known).take,
    ['residency@culturehub.org'])
})

test('空的、null 的、脏的，都不该混进去', () => {
  assert.deepEqual(pickAddresses(['', null, undefined, '   '], known).take, [])
})

// ── 兜底那条路 ────────────────────────────────────────────────
// 兜底不走 pickAddresses（它是「碰到了谁」那条路的门）。兜底自己去查
// 「谁名下还欠着信」，所以不需要转圈：搬掉的下次就不在待搬集合里了，
// 饿不死任何地址。

test('这轮没碰到谁，就是没碰到谁——不能顺手变成全扫', () => {
  // 分不清这两者的话，一轮「没有新信」会变成 117 个地址全跑一遍。
  assert.deepEqual(pickAddresses([], known).take, [])
  assert.deepEqual(pickAddresses(null, known).take, [])
})

// ── 截断要报出来 ────────────────────────────────────────────────

test('超过上限就截断，剩下的数目要交代清楚', () => {
  const many = Array.from({ length: 30 }, (_, i) => `p${i}@x.org`)
  const all = new Set(many)
  const { take, deferred } = pickAddresses(many, all, 12)
  assert.equal(take.length, 12)
  assert.equal(deferred.length, 18)
  // 截掉的那些一封都没丢：它们还在账本里，兜底会重新算出来
  assert.equal(take.length + deferred.length, 30)
})

test('没超上限就没有推迟的', () => {
  assert.equal(pickAddresses(['stacy@culturehub.org'], known).deferred.length, 0)
})
