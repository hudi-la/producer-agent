// 决定闸门。例句全部取自线上 2026-09 ~ 10 真实被误记的那些（体检报告第一节）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeAsk, claimsSent, sentWithin, gateStateMove, gateMemo } from './decisions.js'

const NOW = new Date('2026-10-24T12:00:00Z')

test('问句和请求认得出：这些曾被当成「决定笔」或「记忆」的正文', () => {
  for (const s of ['这个是什么啊', 'has anyone been awarded this scholarship from the usa', '需要什么时候跟进',
    '你帮我查一查，这一个机构每一个机构到底是什么样子的方向的？', 'Find the information for the residency.',
    '好啊，我觉得好像没啥问题。你觉得有啥问题吗？', '有没有往届名单']) {
    assert.equal(looksLikeAsk(s), true, s)
  }
})

test('陈述和「帮我记一下」不算问句：这些该照常落地', () => {
  for (const s of ['约了今天下午3点钟见面。', '帮我记一下吧。 val，约了下周一中午12点见面。',
    '跟他说的价格是300刀到500刀。 你可以记一下。', '9/12 见完了。当时讲了一些',
    '可以。 我其实不是很在意电脑是否通宵运行。', '对方在 WhatsApp 上面给我发了信息了。 我跟他说了，星期五下午问他行不行。',
    'I dont need residencies in these days', '他们说他们准备所有，我只带树皮。']) {
    assert.equal(looksLikeAsk(s), false, s)
  }
})

test('「已发出」类理由认得出', () => {
  assert.equal(claimsSent('今天发出第三次跟进（这次改抄residency@）'), true)
  assert.equal(claimsSent('已发第二次跟进到Mattie个人邮箱'), true)
  assert.equal(claimsSent('Receipt was confirmed; we sent a follow-up'), true)
  assert.equal(claimsSent('她说的是月底前，才过四天'), false)
})

const sent = (days) => ({ id: 's', kind: 'email', role: 'artist', created_at: new Date(NOW - days * 86400000).toISOString() })
const draft = { id: 'd', kind: 'gmail_draft', role: 'artist', created_at: NOW.toISOString() }

test('近几天有没有真的发出过信：草稿和预约不算', () => {
  assert.equal(sentWithin([sent(1)], 3, NOW), true)
  assert.equal(sentWithin([sent(5)], 3, NOW), false)
  assert.equal(sentWithin([draft], 3, NOW), false)
  assert.equal(sentWithin([{ ...sent(0), created_at: new Date(NOW.getTime() + 86400000).toISOString() }], 3, NOW), false)
})

test('后台到点提的一律只是建议', () => {
  const g = gateStateMove({ move: { move: 'reschedule', why: '对方说月底前', due: '2026-11-01' }, source: 'timer', msgs: [], now: NOW })
  assert.deepEqual(g, { apply: false, reason: 'background', noteText: null })
})

test('聊天里声称已发出、却找不到真信：只是建议；找得到就落地', () => {
  const mv = { move: 'wait', why: '今天发出第三次跟进', awaiting: '回复', due: '2026-11-01' }
  assert.equal(gateStateMove({ move: mv, source: 'chat', userText: '好', msgs: [draft], now: NOW }).reason, 'unverified-send')
  assert.equal(gateStateMove({ move: mv, source: 'chat', userText: '发了', msgs: [sent(0)], now: NOW }).apply, true)
})

test('聊天里落地时：陈述做笔的正文，问句不做', () => {
  const mv = { move: 'meeting', why: '他说约了', meet_at: '2026-10-25T15:00' }
  assert.equal(gateStateMove({ move: mv, source: 'chat', userText: '约了周六下午3点见面。', now: NOW }).noteText, '约了周六下午3点见面。')
  const q = gateStateMove({ move: { move: 'reschedule', why: '对方说月底前', due: '2026-11-01' }, source: 'chat', userText: '需要什么时候跟进', now: NOW })
  assert.equal(q.apply, true); assert.equal(q.noteText, null)
})

test('记忆只记陈述', () => {
  const memo = { to: 'line', text: 'x' }
  assert.equal(gateMemo({ memo, userText: '你帮我查一查这个机构' }).apply, false)
  assert.equal(gateMemo({ memo, userText: '他是我 CalArts 的老师。' }).apply, true)
  assert.equal(gateMemo({ memo: null, userText: 'x' }).apply, false)
})
