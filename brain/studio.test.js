// 书桌那版 prompt 的尺子。
//
// 这支盯着两件不能出错的事：
//   · 它手里没有写库的能力，人格里也不许装出有（「我帮你改好了」是句假话）
//   · 19,486 字符的信息库留在静态块里，「正在改的这一条」留在 user message 里
//     ——切错一边，每开一条条目都各自全价读一遍那两万字
//
// 跑：node --test brain/studio.test.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STUDIO_SYSTEM, entryBlock, studioParts,
  buildStudioSystem, buildStudioUser,
} from './studio.js'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from './prompt.js'

const profile = { name: 'Hu Di', website: 'https://hudiworks.com', data: { visa: 'O-1', location: ['LA'] } }

const entries = [
  { id: 'w1', kind: 'work', title: '花园', body: '一段旧描述', medium: '影像' },
  { id: 'o1', kind: 'offer', title: '四周工作坊', body: '给美术馆的' },
  { id: 'o2', kind: 'offer', title: '在写的驻校课', body: '才起了个头', draft: true },
]

// 桌上摊着的那一条 = entries 里的 o2（同一个东西，库那边分两个键给回来）。
const ctx = { profile, entries, msgs: [], entry: entries[2] }

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

// ── 桌上摊着的那一条 ────────────────────────────────────────────────────

test('桌上那一条：标题、id、全文描述都摊开', () => {
  const out = entryBlock(entries[0]).join('\n')
  assert.ok(out.includes('花园'))
  assert.ok(out.includes('w1'))
  assert.ok(out.includes('一段旧描述'))
})

test('桌上那一条：描述是空的就说空的，不留一段假装有内容的空白', () => {
  const out = entryBlock({ id: 'x', kind: 'offer', title: '刚建的' }).join('\n')
  assert.ok(/空的|还没写/.test(out))
})

test('桌上那一条：盒子摊开 —— 改描述时正该用那些料', () => {
  const out = entryBlock({ id: 'x', kind: 'work', title: 'A',
                          box: { guardrail: '还没真教过', 没填的那格: '' } }).join('\n')
  assert.ok(out.includes('还没真教过'))
  assert.ok(!out.includes('没填的那格'))
})

test('桌上那一条：在写的说出来，它才知道这是个半成品', () => {
  assert.ok(entryBlock(entries[2]).join('\n').includes('还在写'))
  assert.ok(!entryBlock(entries[0]).join('\n').includes('还在写'))
})

test('没有条目就没有这一段 —— 没有条目就没有对话', () => {
  assert.deepEqual(entryBlock(null), [])
  assert.deepEqual(entryBlock({}), [])
})

// ── 三档切在哪儿 ─────────────────────────────────────────────

test('信息库在静态块，桌上那一条在 user message——切反了每条都要重读两万字', () => {
  const [静, 界, 动] = buildStudioSystem(ctx)
  assert.equal(界, SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  assert.ok(静.includes('花园'), '写完的条目该在静态块里')
  assert.ok(!静.includes('## 他正在改这一条'), '桌上那一条不许进静态块')
  assert.equal(动, '', '一条一个对话，动态块是空的')

  const u = buildStudioUser(ctx, '这段描述不准', null)
  assert.ok(u.includes('## 他正在改这一条'))
  assert.ok(u.includes('这段描述不准'))
})

test('换一条，静态块逐字相同——缓存能不能跨条目命中就看这个', () => {
  const a = buildStudioSystem(ctx)[0]
  const b = buildStudioSystem({ ...ctx, entry: entries[0] })[0]
  assert.equal(a, b)
})

test('在写的那几条在 user message 里，不在静态块里——他每改一下不该废掉缓存', () => {
  const [静] = buildStudioSystem(ctx)
  assert.ok(!静.includes('还在写的（标着'))
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

test('人格里交代了「这次就说这一条」——别的条目是弹药不是任务', () => {
  assert.ok(/就说这一条/.test(STUDIO_SYSTEM(profile)))
})

// ── 重开一轮（0128）─────────────────────────────────────────

test('划了线之后，只读线以下的 —— 线以上的不再进 prompt', () => {
  const c = { ...ctx, msgs: [
    { id: 'm1', role: 'artist', content: '上一轮说的话' },
    { id: 'm2', role: 'producer', content: '上一轮的回答' },
    { id: 'm3', role: 'system', kind: 'restart', content: '从这儿重开一轮' },
    { id: 'm4', role: 'artist', content: '这一轮说的话' },
  ] }
  const u = buildStudioUser(c, '刚说的', null)
  assert.ok(!u.includes('上一轮说的话'))
  assert.ok(!u.includes('上一轮的回答'))
  assert.ok(u.includes('这一轮说的话'))
  assert.ok(!u.includes('从这儿重开一轮'), '线本身不是谁说的话，不进 prompt')
})

test('刚划完线还没说话：明说「从这儿重新开始」，不假装这一条没聊过', () => {
  const c = { ...ctx, msgs: [
    { id: 'm1', role: 'artist', content: '上一轮说的话' },
    { id: 'm3', role: 'system', kind: 'restart', content: '从这儿重开一轮' },
  ] }
  const u = buildStudioUser(c, '刚说的', null)
  assert.ok(!u.includes('上一轮说的话'))
  assert.ok(/重开一轮|重新开始/.test(u))
})

test('划了两道线，只认最后那道', () => {
  const c = { ...ctx, msgs: [
    { id: 'a', role: 'artist', content: '第一轮' },
    { id: 'b', role: 'system', kind: 'restart', content: '线' },
    { id: 'c', role: 'artist', content: '第二轮' },
    { id: 'd', role: 'system', kind: 'restart', content: '线' },
    { id: 'e', role: 'artist', content: '第三轮' },
  ] }
  const u = buildStudioUser(c, '刚说的', null)
  assert.ok(!u.includes('第一轮') && !u.includes('第二轮'))
  assert.ok(u.includes('第三轮'))
})

test('没划过线的照旧：全部往来都在', () => {
  const c = { ...ctx, msgs: [
    { id: 'm1', role: 'artist', content: '很早说的' },
    { id: 'm2', role: 'producer', content: '它的回答' },
  ] }
  const u = buildStudioUser(c, '刚说的', null)
  assert.ok(u.includes('很早说的') && u.includes('它的回答'))
})

test('撤掉的那几条仍然不算数（线以下也一样）', () => {
  const c = { ...ctx, msgs: [
    { id: 'b', role: 'system', kind: 'restart', content: '线' },
    { id: 'c', role: 'artist', content: '撤掉的那句', deleted_at: '2026-09-17T00:00:00Z' },
    { id: 'e', role: 'artist', content: '留着的那句' },
  ] }
  const u = buildStudioUser(c, '刚说的', null)
  assert.ok(!u.includes('撤掉的那句'))
  assert.ok(u.includes('留着的那句'))
})
