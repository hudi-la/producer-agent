import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toUrl, fromUrl } from './route.js'

const P = '/'
const V = { home: { name: 'home' } }

test('首页就是干净地址 —— pursue 是默认，不写进 URL', () => {
  assert.equal(toUrl('pursue', V.home, P), '/')
})

test('主区记得住 —— 刷新还在人际管理', () => {
  assert.equal(toUrl('people', V.home, P), '/?a=people')
  assert.equal(fromUrl('?a=people').area, 'people')
  assert.equal(fromUrl('?a=profile').area, 'profile')
})

test('认不出的主区一律忽略，不猜', () => {
  assert.equal(fromUrl('?a=nonsense').area, null)
})

test('名片抽屉：写得出也读得回', () => {
  const u = toUrl('people', { name: 'person', person: { id: 'abc' }, mode: 'drawer' }, P)
  assert.equal(u, '/?a=people&c=abc&d=1')
  assert.deepEqual(fromUrl('?a=people&c=abc&d=1'), { area: 'people', card: { kind: 'contact', id: 'abc', drawer: true } })
})

test('机构名带空格也扛得住 —— 编码解码一趟回来还是原样', () => {
  const org = 'San Francisco Center for the Book'
  const u = toUrl('people', { name: 'org', org: { org } }, P)
  assert.equal(fromUrl(u.slice(u.indexOf('?'))).card.id, org)
})

test('带 d=1 是某个区旁边的抽屉；不带就是桌上那张，主区一律 desk', () => {
  assert.equal(toUrl('desk', { name: 'pursuit', pursuit: { id: 'p1' } }, P), '/?p=p1')
  assert.equal(toUrl('pursue', { name: 'pursuit', pursuit: { id: 'p1' }, mode: 'drawer' }, P), '/?p=p1&d=1')
  assert.deepEqual(fromUrl('?p=p1'), { area: 'desk', card: { kind: 'pursuit', id: 'p1', drawer: false } })
  assert.deepEqual(fromUrl('?a=people&p=p1'), { area: 'desk', card: { kind: 'pursuit', id: 'p1', drawer: false } })
  assert.equal(fromUrl('?p=p1&d=1').area, null)   // 没写 a → 默认 pursue
})

test('空桌也有地址', () => {
  assert.equal(toUrl('desk', { name: 'home' }, P), '/?a=desk')
  assert.equal(fromUrl('?a=desk').area, 'desk')
})

// 同时出现时不去猜哪个更「对」—— 那种行为会随实现顺序变，查起来要命
test('卡片参数三选一，顺序写死 p → c → o', () => {
  assert.equal(fromUrl('?p=1&c=2&o=3').card.kind, 'pursuit')
  assert.equal(fromUrl('?c=2&o=3').card.kind, 'contact')
  assert.equal(fromUrl('?o=3').card.kind, 'org')
})

test('什么都没有就是首页', () => {
  assert.deepEqual(fromUrl(''), { area: null, card: null })
  assert.deepEqual(fromUrl('?').card, null)
})

// 这条是为那个真 bug 写的：刷新之后不管你在哪都弹回首页。
// 往返一趟必须还是同一个地方，否则「你刚才在做的事」就没了。
test('转一圈回来还是同一个地方', () => {
  const cases = [
    ['pursue', V.home], ['people', V.home], ['profile', V.home], ['desk', V.home],
    ['people', { name: 'person', person: { id: 'c1' }, mode: 'drawer' }],
    ['people', { name: 'org', org: { org: 'CultureHub' }, mode: 'drawer' }],
    ['pursue', { name: 'pursuit', pursuit: { id: 'p1' }, mode: 'drawer' }],
    ['desk', { name: 'pursuit', pursuit: { id: 'p1' } }],
    ['desk', { name: 'person', person: { id: 'c1' } }],
    ['desk', { name: 'org', org: { org: 'ZKM' } }],
  ]
  for (const [area, view] of cases) {
    const u = toUrl(area, view, P)
    const back = fromUrl(u.includes('?') ? u.slice(u.indexOf('?')) : '')
    assert.equal(back.area ?? 'pursue', area, `主区没转回来：${u}`)
    if (view.name === 'home') assert.equal(back.card, null, `不该有卡：${u}`)
    else assert.ok(back.card, `卡丢了：${u}`)
  }
})
