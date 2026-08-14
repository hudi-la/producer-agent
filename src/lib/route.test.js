import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toUrl, fromUrl, tabUrl } from './route.js'

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

test('名片：写得出也读得回', () => {
  const u = toUrl('people', { name: 'person', person: { id: 'abc' } }, P)
  assert.equal(u, '/?a=people&c=abc')
  assert.deepEqual(fromUrl('?a=people&c=abc').card, { kind: 'contact', id: 'abc' })
})

test('机构名带空格也扛得住 —— 编码解码一趟回来还是原样', () => {
  const org = 'San Francisco Center for the Book'
  const u = toUrl('people', { name: 'org', org: { org } }, P)
  assert.equal(fromUrl(u.slice(u.indexOf('?'))).card.id, org)
})

test('机会线分整页和抽屉 —— 刷新回来还是原来那一档', () => {
  const page = toUrl('pursue', { name: 'pursuit', pursuit: { id: 'p1' }, mode: 'page' }, P)
  const draw = toUrl('pursue', { name: 'pursuit', pursuit: { id: 'p1' }, mode: 'drawer' }, P)
  assert.equal(page, '/?p=p1')
  assert.equal(draw, '/?p=p1&d=1')
  assert.equal(fromUrl('?p=p1').card.drawer, false)
  assert.equal(fromUrl('?p=p1&d=1').card.drawer, true)
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
    ['pursue', V.home],
    ['people', V.home],
    ['profile', V.home],
    ['people', { name: 'person', person: { id: 'c1' } }],
    ['people', { name: 'org', org: { org: 'CultureHub' } }],
    ['pursue', { name: 'pursuit', pursuit: { id: 'p1' }, mode: 'page' }],
    ['pursue', { name: 'pursuit', pursuit: { id: 'p1' }, mode: 'drawer' }],
  ]
  for (const [area, view] of cases) {
    const u = toUrl(area, view, P)
    const back = fromUrl(u.includes('?') ? u.slice(u.indexOf('?')) : '')
    assert.equal(back.area ?? 'pursue', area, `主区没转回来：${u}`)
    if (view.name === 'home') assert.equal(back.card, null, `不该有卡：${u}`)
    else assert.ok(back.card, `卡丢了：${u}`)
  }
})

// ── 新标签页的地址 ──────────────────────────────────────────────
// 这两条是为一个真 bug 写的回归测试：抽屉打开一条线时地址是 ?p=xxx&d=1，
// 「整页」按钮拿当前地址复制一份再设 p，于是 d=1 跟着过去——
// 新标签页打开的还是抽屉，用户看到的是「整页按钮不灵了」。

test('整页链接不许带 d=1 —— 带了就还是抽屉', () => {
  const u = tabUrl('p', 'p1', P)
  assert.equal(u, '/?p=p1')
  assert.equal(fromUrl(u.slice(u.indexOf('?'))).card.drawer, false)
})

test('开一张新卡不许捎上别的参数', () => {
  const u = tabUrl('c', 'c2', P)
  assert.equal(u, '/?c=c2')
  const back = fromUrl(u.slice(u.indexOf('?')))
  assert.equal(back.card.kind, 'contact')
  assert.equal(back.area, null)          // 上一个 ?a= 也不该跟过来
})
