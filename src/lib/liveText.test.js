import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liveInit, liveStep, HOLD_MS, stripTag } from './liveText.js'

const run = (events) => events.reduce((s, [e, now]) => liveStep(s, e, now), liveInit())
const d = (text) => ({ t: 'delta', text })
const tool = { t: 'tool', name: 'WebSearch' }

test('普通对话：没动过工具，第一个字立刻上屏', () => {
  const s = run([[d('算'), 0], [d('，但不是'), 10], [d('你以为的那一层。'), 20]])
  assert.equal(s.text, '算，但不是你以为的那一层。')
  assert.equal(s.pend, '')
})

test('动工具 = 刚才那行开场白作废，屏幕上抹干净', () => {
  const s = run([
    [d("I'll start by loading "), 0],
    [d('the web tools.'), 100],
    [tool, 300],
  ])
  assert.equal(s.text, '', '开场白必须一个字都不剩')
})

test('动过工具之后，短开场白在上屏之前就作废了 —— 一眼都看不见', () => {
  const s = run([
    [d('查'), 0], [tool, 100],                       // 第一轮，进入按住模式
    [d("Let me fetch it."), 200],                    // 第二行开场白，开始按住
    [tool, 450],                                     // 250ms 后就动工具了 < HOLD
  ])
  assert.equal(s.text, '')
  assert.equal(s.pend, '', '作废时按住的也要一起清掉')
})

test('熬过 HOLD 的那段是回答，放行，之后这段直接画', () => {
  const s = run([
    [tool, 0],
    [d('我把两个人'), 100],
    [d('都挖了一遍'), 200],
    [d('，先说一件事。'), 100 + HOLD_MS],            // 到点了，连同按住的一起上屏
    [d('接着说。'), 100 + HOLD_MS + 10],             // 之后不再按住
  ])
  assert.equal(s.text, '我把两个人都挖了一遍，先说一件事。接着说。')
  assert.equal(s.open, true)
})

test('放行之后又动工具，照样从头抹掉', () => {
  const s = run([
    [tool, 0],
    [d('中间那段英文报告'), 100],
    [d('还在写'), 100 + HOLD_MS],                    // 熬过去了，画出来了
    [tool, 900],                                      // 结果又去查资料 → 作废
  ])
  assert.equal(s.text, '')
  assert.equal(s.open, false, '重新进入按住模式')
})

test('按住期间时钟没走满就不上屏', () => {
  const s = run([[tool, 0], [d('半路'), 100], [d('还没到点'), 100 + HOLD_MS - 1]])
  assert.equal(s.text, '')
  assert.equal(s.pend, '半路还没到点')
})

test('空 delta 不改变任何东西', () => {
  const a = run([[d('字'), 0]])
  assert.deepEqual(liveStep(a, d(''), 5), a)
  assert.deepEqual(liveStep(a, { t: 'thinking' }, 5), a)
  assert.deepEqual(liveStep(a, null, 5), a)
})

test('一轮回复的完整形状：开场白 → 查 → 开场白 → 查 → 回答', () => {
  const s = run([
    [d("I'll start by loading the web tools."), 0],
    [tool, 400],
    [d('Excellent — MAT has a PhD Dissertations page. Let me fetch it.'), 500],
    [tool, 800],
    [d('我把两个人都挖了一遍。'), 900],
    [d('先说一件会改这条线性质的事。'), 900 + HOLD_MS],
  ])
  assert.equal(s.text, '我把两个人都挖了一遍。先说一件会改这条线性质的事。')
  assert.ok(!s.text.includes("I'll"))
  assert.ok(!s.text.includes('Let me fetch'))
})

// ── 末尾那行机器读的字不上屏 ────────────────────────────────

test('边想边出字时，末尾那行机器读的字不上屏', () => {
  assert.equal(stripTag('正文。\n\n[[LETTER]] {"to":"a@b.c"}'), '正文。')
})

test('标记才流出来一半也不许露脸', () => {
  assert.equal(stripTag('正文。\n\n[['), '正文。')
  assert.equal(stripTag('正文。\n\n[[LET'), '正文。')
  assert.equal(stripTag('正文。\n\n[[LETTER]]'), '正文。')
  assert.equal(stripTag('正文。\n\n[[LETTER]] {"to":"a@'), '正文。')
})

test('正文里本来就有方括号的不能被误伤', () => {
  assert.equal(stripTag('见 [1] 那条。'), '见 [1] 那条。')
  assert.equal(stripTag('这是一个 [链接](http://x)'), '这是一个 [链接](http://x)')
})

test('[[FACTS]] 那种也一起挡——讲懂那条路末尾也贴机器读的字', () => {
  assert.equal(stripTag('讲完了。\n\n[[FACTS]]{"url":null}'), '讲完了。')
})

test('没有标记就原样交出，一个字不动', () => {
  assert.equal(stripTag('就是一段普通回复。'), '就是一段普通回复。')
  assert.equal(stripTag(''), '')
})
