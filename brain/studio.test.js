// 书桌那版 prompt 的尺子。
//
// 这支盯着两件不能出错的事：
//   · 它手里没有写库的能力，人格里也不许装出有（「我帮你改好了」是句假话）
//   · 19,486 字符的信息库留在静态块里，焦点留在 user message 里
//     ——切错一边，每一栏各自全价读一遍那两万字
//
// 跑：node --test brain/studio.test.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STUDIO_SYSTEM, focusBlock, studioParts,
  buildStudioSystem, buildStudioUser,
} from './studio.js'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from './prompt.js'

const profile = { name: 'Hu Di', website: 'https://hudiworks.com', data: { visa: 'O-1', location: ['LA'] } }

const entries = [
  { id: 'w1', kind: 'work', title: '花园', body: '一段旧描述', medium: '影像' },
  { id: 'o1', kind: 'offer', title: '四周工作坊', body: '给美术馆的' },
  { id: 'o2', kind: 'offer', title: '在写的驻校课', body: '才起了个头', draft: true },
]

const ctx = {
  profile, entries, msgs: [],
  focus: { label: '工作坊 · 可提供', count: 2, open: [{ id: 'o2', title: '在写的驻校课' }] },
}

// ── 人格 ────────────────────────────────────────────────────

test('人格里写死了「你改不了他的档案」', () => {
  const s = STUDIO_SYSTEM(profile)
  assert.ok(/你不动他的档案|你改不了/.test(s), s.slice(0, 400))
})

test('人格里不带写信、填表、拨状态那三条规矩——这张桌子不干那些活', () => {
  const s = STUDIO_SYSTEM(profile)
  assert.ok(!s.includes('[[LETTER]]'))
  assert.ok(!s.includes('[[FORM]]'))
  assert.ok(!s.includes('[[STATE]]'))
  assert.ok(!s.includes('[[MEMO]]'))
})

test('人格里认得出他是谁', () => {
  assert.ok(STUDIO_SYSTEM(profile).includes('Hu Di'))
  // 档案里没填就不编一个出来
  assert.ok(!STUDIO_SYSTEM(null).includes('undefined'))
})

test('人格里交代了查回来的东西要说出处', () => {
  assert.ok(/哪儿来|出处|来源/.test(STUDIO_SYSTEM(profile)))
})

// ── 焦点 ────────────────────────────────────────────────────

test('焦点：展开着的条目带 id 列出来', () => {
  const out = focusBlock(ctx.focus).join('\n')
  assert.ok(out.includes('工作坊 · 可提供'))
  assert.ok(out.includes('2'))
  assert.ok(out.includes('在写的驻校课'))
  assert.ok(out.includes('o2'))
})

test('焦点：一条没展开就只说栏，不留一个空的「展开着：」', () => {
  const out = focusBlock({ label: '自述 · Bio', count: 2, open: [] }).join('\n')
  assert.ok(out.includes('自述 · Bio'))
  assert.ok(!out.includes('展开着'))
})

test('焦点：没有焦点就整块不出现', () => {
  assert.deepEqual(focusBlock(null), [])
  assert.deepEqual(focusBlock({}), [])
})

// ── 三档切在哪儿 ─────────────────────────────────────────────

test('信息库在静态块，焦点在 user message——切反了每栏都要重读两万字', () => {
  const [静, 界, 动] = buildStudioSystem(ctx)
  assert.equal(界, SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  assert.ok(静.includes('花园'), '写完的条目该在静态块里')
  assert.ok(!静.includes('o2'), '焦点不许进静态块')
  assert.ok(!静.includes('工作坊 · 可提供'), '栏名不许进静态块')
  assert.equal(动, '', '书桌没有「每条线不同」的东西，动态块是空的')

  const u = buildStudioUser(ctx, '这段描述不准', null)
  assert.ok(u.includes('o2'))
  assert.ok(u.includes('这段描述不准'))
})

test('两栏之间静态块逐字相同——缓存能不能跨栏命中就看这个', () => {
  const a = buildStudioSystem(ctx)[0]
  const b = buildStudioSystem({ ...ctx, focus: { label: '作品', count: 11, open: [] } })[0]
  assert.equal(a, b)
})

test('在写的那几条在 user message 里，不在静态块里——他每改一下不该废掉缓存', () => {
  const [静] = buildStudioSystem(ctx)
  assert.ok(!静.includes('在写的驻校课'))
  const u = buildStudioUser(ctx, '继续写', null)
  assert.ok(u.includes('在写的驻校课'))
  assert.ok(/还在写|没写完/.test(u), '得标出来这几条是没写完的')
})

test('往来里把刚落库的那句摘出去，不出现两遍', () => {
  const c = { ...ctx, msgs: [{ id: 'm1', role: 'artist', content: '这段描述不准' }] }
  const u = buildStudioUser(c, '这段描述不准', 'm1')
  assert.equal(u.match(/这段描述不准/g).length, 1)
})

test('往来空的时候说一句「刚开始」，不留一段空白', () => {
  const u = buildStudioUser(ctx, '你好', null)
  assert.ok(/刚开始|还没/.test(u))
})

test('三档首尾相接就是整根 prompt——没有一段走丢', () => {
  const { fixed, perLine, talk } = studioParts(ctx, '刚说的', null)
  const 全 = [...fixed, ...perLine, ...talk].join('\n')
  assert.ok(全.includes('花园'))
  assert.ok(全.includes('在写的驻校课'))
  assert.ok(全.includes('o2'))
  assert.ok(全.includes('刚说的'))
  assert.deepEqual(perLine, [])
})
