import test from 'node:test'
import assert from 'node:assert/strict'
import { extractStateMove, extractMemo, peelEnvelopes, moveLine, memoLine, stateBlock, stateLine, localToday, MOVES, MEMO_RULE } from './stateMove.js'

const today = '2026-09-04'
const 信封 = (j) => `我看不用再催了。\n\n[[STATE]] ${JSON.stringify(j)}`

test('wait：齐全就摘出来，正文里不留标记', () => {
  const { clean, move } = extractStateMove(信封({ move: 'wait', why: '她 8/11 说过想聊', awaiting: '等她接电话', due: '2026-09-12' }), { today })
  assert.equal(clean, '我看不用再催了。')
  assert.deepEqual(move, { move: 'wait', why: '她 8/11 说过想聊', awaiting: '等她接电话', due: '2026-09-12' })
})

test('wait：缺 due / due 是今天 / due 不是日期 / 缺 awaiting → 丢', () => {
  for (const bad of [
    { move: 'wait', why: 'x', awaiting: 'y' },
    { move: 'wait', why: 'x', awaiting: 'y', due: today },
    { move: 'wait', why: 'x', awaiting: 'y', due: '9/12' },
    { move: 'wait', why: 'x', due: '2026-09-12' },
  ]) assert.equal(extractStateMove(信封(bad), { today }).move, null, JSON.stringify(bad))
})

test('今天不知道 → 带日子的一律丢（宁可不落，不落错）', () => {
  assert.equal(extractStateMove(信封({ move: 'park', why: 'x', due: '2026-10-01' })).move, null)
})

test('缺 why → 丢；不认识的 move → 丢', () => {
  assert.equal(extractStateMove(信封({ move: 'done' }), { today }).move, null)
  assert.equal(extractStateMove(信封({ move: 'pause', why: 'x' }), { today }).move, null)
})

test('resolved：可带 needs_reply；没 reply_why 就只丢 needs_reply', () => {
  const a = extractStateMove(信封({ move: 'resolved', why: '她定了 9/9', needs_reply: true, reply_why: '要确认时间' }), { today }).move
  assert.deepEqual(a, { move: 'resolved', why: '她定了 9/9', needs_reply: true, reply_why: '要确认时间' })
  const b = extractStateMove(信封({ move: 'resolved', why: '她定了 9/9', needs_reply: true }), { today }).move
  assert.deepEqual(b, { move: 'resolved', why: '她定了 9/9' })
})

test('needs_reply 缺 reply_why → 丢；meeting 缺 meet_at → 丢，纯日期给中午', () => {
  assert.equal(extractStateMove(信封({ move: 'needs_reply', why: 'x' }), { today }).move, null)
  assert.equal(extractStateMove(信封({ move: 'meeting', why: 'x' }), { today }).move, null)
  assert.equal(extractStateMove(信封({ move: 'meeting', why: 'x', meet_at: '2026-09-11' }), { today }).move.meet_at, '2026-09-11T12:00')
  assert.equal(extractStateMove(信封({ move: 'meeting', why: 'x', meet_at: '2026-09-11T12:00' }), { today }).move.meet_at, '2026-09-11T12:00')
})

test('信封坏了不连累正文', () => {
  const { clean, move } = extractStateMove('正文在这儿。\n\n[[STATE]] {坏掉的', { today })
  assert.ok(clean.includes('正文在这儿。'))
  assert.equal(move, null)
})

test('没信封就当没有', () => {
  const { clean, move } = extractStateMove('普通一句。', { today })
  assert.equal(clean, '普通一句。')
  assert.equal(move, null)
})

test('小卡那行字', () => {
  assert.equal(moveLine({ move: 'wait', awaiting: '等她接电话', due: '2026-09-12' }), '等她接电话 · 到 9/12')
  assert.equal(moveLine({ move: 'reschedule', due: '2026-09-12' }), '到点日改到 9/12')
  assert.equal(moveLine({ move: 'park', due: '2026-10-01' }), '先放到 10/1')
  assert.equal(moveLine({ move: 'resolved' }), '不用再等了')
  assert.equal(moveLine({ move: 'resolved', needs_reply: true }), '不用再等了，但这封要回')
  assert.equal(moveLine({ move: 'needs_reply' }), '这封要回')
  assert.equal(moveLine({ move: 'meeting', meet_at: '2026-09-11T12:00' }), '约了 9/11 见面')
  assert.equal(moveLine({ move: 'done' }), '这件事不用管了')
})

test('提醒栏那段：没 state 说没有；stopped 说连发几封', () => {
  assert.ok(stateBlock(null).join('\n').includes('没有这条线的事'))
  const s = stateLine({ state: 'WAITING_REPLY', what: '等她排一次会', due_at: '2026-09-01T07:00:00+00:00', zone: 'stopped', followups: 2 })
  assert.ok(s.includes('等她排一次会') && s.includes('2026-09-01') && s.includes('连发 3 封'), s)
  const r = stateLine({ state: 'WAITING_REPLY', what: 'x', due_at: '2026-09-09', zone: 'due', replied_at: '2026-09-03T01:00:00+00:00' })
  assert.ok(r.includes('2026-09-03 来信了'), r)
})

test('localToday 按时区', () => {
  const at = new Date('2026-09-05T03:00:00Z')      // LA 还是 9/4 晚上
  assert.equal(localToday('America/Los_Angeles', at), '2026-09-04')
  assert.equal(localToday('Asia/Shanghai', at), '2026-09-05')
})

test('八种拨法是封闭的', () => assert.equal(MOVES.length, 8))

test('met：只要 why；小卡说「见成了」', () => {
  const { move } = extractStateMove(信封({ move: 'met', why: '他说今天见了' }), { today })
  assert.deepEqual(move, { move: 'met', why: '他说今天见了' })
  assert.equal(moveLine(move), '见成了')
})

test('MEMO：to 只认 line|person，text 空的不算', () => {
  assert.deepEqual(extractMemo('x\n[[MEMO]] {"to":"line","text":"资助只报销机票"}').memo, { to: 'line', text: '资助只报销机票' })
  assert.equal(extractMemo('x\n[[MEMO]] {"to":"org","text":"y"}').memo, null)
  assert.equal(extractMemo('x\n[[MEMO]] {"to":"person","text":"  "}').memo, null)
  assert.equal(extractMemo('x\n[[MEMO]] {坏的').clean, 'x\n[[MEMO]] {坏的')
})

test('两个信封同出，顺序不定，都剥得下来，正文干净', () => {
  const a = '见成了，那就等他上司的话。\n\n[[STATE]] {"move":"met","why":"他说见了"}\n[[MEMO]] {"to":"line","text":"报价 500"}'
  const b = '见成了，那就等他上司的话。\n\n[[MEMO]] {"to":"line","text":"报价 500"}\n[[STATE]] {"move":"met","why":"他说见了"}'
  for (const t of [a, b]) {
    const r = peelEnvelopes(t, { today })
    assert.equal(r.clean, '见成了，那就等他上司的话。', t)
    assert.equal(r.move?.move, 'met'); assert.equal(r.memo?.text, '报价 500')
  }
  const only = peelEnvelopes('普通一句。', { today })
  assert.equal(only.clean, '普通一句。'); assert.equal(only.move, null); assert.equal(only.memo, null)
})

test('memoLine 截到 80 字', () => {
  assert.equal(memoLine({ text: 'a'.repeat(100) }).length, 80)
  assert.ok(MEMO_RULE.includes('[[MEMO]]'))
})
