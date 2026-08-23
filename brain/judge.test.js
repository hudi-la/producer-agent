import test from 'node:test'
import assert from 'node:assert/strict'
import { eventOf, parseTag, cellFor, TRANSITIONS, factText } from './judge.js'
import * as mod from './judge.js'

// ── event 识别 ────────────────────────────────────────────────

test('信按方向分：你发的是 MY_LETTER，来的是 THEIR_LETTER', () => {
  assert.equal(eventOf({ kind: 'email', role: 'artist' }), 'MY_LETTER')
  assert.equal(eventOf({ kind: 'email', role: 'org' }), 'THEIR_LETTER')
})

test('笔、见面、决定都是 NOTE；别的不是 event', () => {
  for (const k of ['note', 'meet', 'decision']) assert.equal(eventOf({ kind: k }), 'NOTE')
  for (const k of ['message', 'brief', 'gmail_draft', 'draft']) assert.equal(eventOf({ kind: k }), null)
})

// ── 成对规矩（跟 parseRejudge 一个脾气）──────────────────────

test('awaiting 没有 wait_days → 两个都丢：没有到点日的等待等于没设', () => {
  const t = parseTag('x\n[[TAG]] {"gist":"g","awaiting":"等回复"}')
  assert.equal(t.awaiting, null)
  assert.equal(t.wait_days, null)
})

test('wait_days 得是正整数，0、负数、小数都不算', () => {
  for (const bad of [0, -3, 2.5, '7']) {
    const t = parseTag(`x\n[[TAG]] {"awaiting":"等","wait_days":${JSON.stringify(bad)}}`)
    assert.equal(t.awaiting, null, `wait_days=${bad} 该作废`)
  }
  const ok = parseTag('x\n[[TAG]] {"awaiting":"等","wait_days":7}')
  assert.equal(ok.wait_days, 7)
})

test('resolves 没有理由 → 不关：悄悄关掉一个等待比多等几天坏得多', () => {
  const t = parseTag('x\n[[TAG]] {"resolves":true}')
  assert.equal(t.resolves, null)
  const ok = parseTag('x\n[[TAG]] {"resolves":true,"resolves_why":"素材前天交了"}')
  assert.equal(ok.resolves, true)
  assert.equal(ok.resolves_why, '素材前天交了')
})

test('resolves=false 原样过——「没解决」本身是个答案，不需要理由', () => {
  const t = parseTag('x\n[[TAG]] {"resolves":false}')
  assert.equal(t.resolves, false)
})

test('needs_reply 没理由 → 填「（没说理由）」：漏一封真信比多吵一条坏', () => {
  const t = parseTag('x\n[[TAG]] {"needs_reply":true}')
  assert.equal(t.needs_reply, true)
  assert.equal(t.reply_why, '（没说理由）')
})

test('meet_at：纯日期给个中午；带时间的原样过；胡写的丢', () => {
  assert.equal(parseTag('x\n[[TAG]] {"meet_at":"2026-09-11"}').meet_at, '2026-09-11T12:00:00')
  assert.equal(parseTag('x\n[[TAG]] {"meet_at":"2026-09-11T12:00"}').meet_at, '2026-09-11T12:00')
  assert.equal(parseTag('x\n[[TAG]] {"meet_at":"下周吧"}').meet_at, null)
})

test('解析不出来一律 null——下场是不写标签、下轮再来，绝不假装判过', () => {
  assert.equal(parseTag('没有标记'), null)
  assert.equal(parseTag('x\n[[TAG]] {坏 json'), null)
  assert.equal(parseTag('x\n[[TAG]] [1,2]'), null)
})

// ── 转移表本身 ────────────────────────────────────────────────

test('稿子第四节的格子都在：一格一个问题', () => {
  const 该有 = [
    ['IDLE', 'THEIR_LETTER'], ['IDLE', 'MY_LETTER'], ['IDLE', 'NOTE'],
    ['WAITING_REPLY', 'THEIR_LETTER'], ['WAITING_REPLY', 'MY_LETTER'], ['WAITING_REPLY', 'NOTE'],
    ['NEEDS_REPLY', 'MY_LETTER'], ['NEEDS_REPLY', 'THEIR_LETTER'], ['NEEDS_REPLY', 'NOTE'],
    ['MEETING_SET', 'THEIR_LETTER'], ['MEETING_SET', 'MY_LETTER'], ['MEETING_SET', 'NOTE'],
  ]
  for (const [s, e] of 该有) assert.ok(cellFor(s, e), `${s} x ${e} 缺了`)
})

test('表里没有的格子返回 null——调用方必须出声，不许静默', () => {
  assert.equal(cellFor('DEBRIEF', 'TIMER'), null)
  assert.equal(cellFor('不存在', 'THEIR_LETTER'), null)
})

test('NEEDS_REPLY x NOTE 是纯规则格：不花钱，只把笔标成判过', () => {
  const cell = cellFor('NEEDS_REPLY', 'NOTE')
  assert.ok(cell.rule && !cell.ask)
  assert.equal(cell.rule({ content: '微信上加了 Weidi' }).gist, '微信上加了 Weidi')
})

// ── 问题得问对：抽查几格的原话 ────────────────────────────────

const fact = (over = {}) => ({
  kind: 'email', role: 'org', created_at: '2026-08-13T10:00:00Z',
  subject_name: 'CultureHub Resident Artist · 2026–27', who: 'Mattie',
  content: '平面图在这儿', body_raw: null, recent: [], ...over,
})
const state = { what: '等平面图和技术对接人', due_at: '2026-08-19T00:00:00Z', why: null }

test('WAITING_REPLY x THEIR_LETTER 问的是「解决了它吗」，且客套那条写死了不许关', () => {
  const p = cellFor('WAITING_REPLY', 'THEIR_LETTER').ask(fact(), state)
  assert.match(p, /我们在等：\*\*等平面图和技术对接人\*\*/)
  assert.match(p, /这封信解决了它吗/)
  assert.match(p, /只是客套.*等待继续/s)
})

test('WAITING_REPLY x MY_LETTER：计时交给视图滑（从最后一封发出起算），格子只判换事/作废', () => {
  const p = cellFor('WAITING_REPLY', 'MY_LETTER').ask(fact({ role: 'artist' }), state)
  assert.match(p, /换掉或作废/)
  assert.match(p, /计时不用你管/)
  assert.match(p, /最后一封发出的信起算/)
})

test('IDLE x MY_LETTER 问「等对方做什么、按惯例等几天」，带惯例数', () => {
  const p = cellFor('IDLE', 'MY_LETTER').ask(fact({ role: 'artist' }), null)
  assert.match(p, /在等对方做什么/)
  assert.match(p, /14 天/)
  assert.match(p, /5 天/)
})

test('IDLE x THEIR_LETTER 拿不准算要回，模糊锚点要落成日子', () => {
  const p = cellFor('IDLE', 'THEIR_LETTER').ask(fact(), null)
  assert.match(p, /拿不准算要回/)
  assert.match(p, /plan on 2027/)
})

test('prompt 里带着往来上下文和这封信自己', () => {
  const p = cellFor('IDLE', 'THEIR_LETTER').ask(fact({
    recent: [{ 日: '2026-08-12', 谁: '你', 说: '素材前天交了' }],
  }), null)
  assert.match(p, /2026-08-12 你：素材前天交了/)
  assert.match(p, /平面图在这儿/)
})

// ── 正文清洗 ──────────────────────────────────────────────────

test('引用尾巴剥掉：判断只看这次说的话', () => {
  const t = factText({ body_raw: '这次说的。\n\nOn Aug 12, 2026, Mattie wrote:\n> 上次的话' })
  assert.equal(t, '这次说的。')
})

test('没有 body_raw 用 content 顶上', () => {
  assert.equal(factText({ content: '梗概' }), '梗概')
})

// ── Task 6 补的格子：DEBRIEF 和 OWE_* ────────────────────────

test('DEBRIEF 三个 event 的格子都在；OWE_* 借用 IDLE 的格子', () => {
  for (const e of ['NOTE', 'THEIR_LETTER', 'MY_LETTER', 'YOUR_ANSWER'])
    assert.ok(cellFor('DEBRIEF', e), `DEBRIEF x ${e} 缺了`)
  assert.ok(cellFor('OWE_THANKS', 'MY_LETTER'))
  assert.equal(cellFor('OWE_MEETING_NOTE', 'MY_LETTER'), cellFor('IDLE', 'MY_LETTER'))
  assert.equal(cellFor('OWE_THANKS', 'THEIR_LETTER'), cellFor('IDLE', 'THEIR_LETTER'))
})

test('OWE_THANKS x MY_LETTER 问「谢过了吗」，顺带也算一句谢', () => {
  const p = cellFor('OWE_THANKS', 'MY_LETTER').ask(
    { kind: 'email', role: 'artist', subject_name: 'Weidi Zhang', who: 'Weidi', content: '谢谢你介绍 Biayna', recent: [] },
    { what: '见到了你经「Weidi」介绍认识的「Biayna」' })
  assert.match(p, /谢过了吗/)
  assert.match(p, /顺带一句也算/)
})

test('parseMet：见成了 / 没见成改约 / 看不出来', () => {
  const { parseMet } = mod
  assert.deepEqual(parseMet('x\n[[TAG]] {"met":true,"gist":"聊了预算"}'),
    { met: true, gist: '聊了预算', meet_at: null })
  const re = parseMet('x\n[[TAG]] {"met":false,"meet_at":"2026-09-18"}')
  assert.equal(re.met, false)
  assert.equal(re.meet_at, '2026-09-18T12:00:00')
  assert.equal(parseMet('x\n[[TAG]] {"met":"maybe"}').met, null)
  assert.equal(parseMet('没标记'), null)
})
