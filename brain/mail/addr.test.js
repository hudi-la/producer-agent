import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headerMap, parseAddr, parseAddrList, isBulk, classify } from './addr.js'

const ME = 'hudi.creates@gmail.com'
const ME2 = 'hudi@calarts.edu'          // 以后要接的第二个地址

const msg = (headers, extra = {}) => ({
  id: 'm1', threadId: 't1',
  internalDate: String(Date.UTC(2026, 6, 15, 12, 0, 0)),   // 2026-07-15
  payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
  ...extra,
})

// ── 拆地址 ──────────────────────────────────────────────────────

test('信头键大小写不敏感', () => {
  const h = headerMap([{ name: 'FROM', value: 'a@x.com' }, { name: 'Subject', value: '喂' }])
  assert.equal(h.from, 'a@x.com')
  assert.equal(h.subject, '喂')
})

test('尖括号、纯地址、带引号的名字都认得出来', () => {
  assert.deepEqual(parseAddr('Zoe Chen <zoe@bampfa.berkeley.edu>'),
    { name: 'Zoe Chen', email: 'zoe@bampfa.berkeley.edu' })
  assert.deepEqual(parseAddr('c@z.com'), { name: null, email: 'c@z.com' })
  assert.deepEqual(parseAddr('"Chen, Zoe" <zoe@x.org>'), { name: 'Chen, Zoe', email: 'zoe@x.org' })
})

test('地址一律转小写——同一个人不能因为大小写变成两个人', () => {
  assert.equal(parseAddr('Zoe <ZOE@Berkeley.EDU>').email, 'zoe@berkeley.edu')
})

test('认不出地址就返回 null，不猜', () => {
  assert.equal(parseAddr('undisclosed-recipients:;'), null)
  assert.equal(parseAddr(''), null)
  assert.equal(parseAddr('Zoe Chen'), null)
})

test('名字里的逗号不会把一串地址拆错', () => {
  const xs = parseAddrList('"Li, Wei" <a@x.com>, Zoe <b@y.com>, c@z.com')
  assert.deepEqual(xs.map((a) => a.email), ['a@x.com', 'b@y.com', 'c@z.com'])
  assert.equal(xs[0].name, 'Li, Wei')
})

test('一串里重复的地址只留一个', () => {
  assert.deepEqual(parseAddrList('a@x.com, A@X.com').map((a) => a.email), ['a@x.com'])
})

// ── 谁跟谁 ──────────────────────────────────────────────────────

test('他发来的：对面是 From，方向是 in', () => {
  const r = classify(msg({ From: 'Zoe <zoe@x.org>', To: ME, Subject: '驻地的事' }), [ME])
  assert.equal(r.direction, 'in')
  assert.equal(r.counterpart_email, 'zoe@x.org')
  assert.equal(r.from_name, 'Zoe')
  assert.equal(r.subject, '驻地的事')
})

test('我发出的：对面是 To 里第一个不是我的，方向是 out', () => {
  const r = classify(msg({ From: `HuDi <${ME}>`, To: 'Zoe <zoe@x.org>' }), [ME])
  assert.equal(r.direction, 'out')
  assert.equal(r.counterpart_email, 'zoe@x.org')
})

test('我发出、To 里带上我自己：跳过我，取真正的对面', () => {
  const r = classify(msg({ From: ME, To: `${ME}, zoe@x.org` }), [ME])
  assert.equal(r.counterpart_email, 'zoe@x.org')
})

test('To 里没有别人就看 Cc', () => {
  const r = classify(msg({ From: ME, To: ME, Cc: 'zoe@x.org' }), [ME])
  assert.equal(r.counterpart_email, 'zoe@x.org')
})

test('我发给我自己：对面就是我，不炸', () => {
  const r = classify(msg({ From: ME, To: ME }), [ME])
  assert.equal(r.direction, 'out')
  assert.equal(r.counterpart_email, ME)
})

// 这条是「结构现在做，线以后接」那个判断的护身符：
// 判据是「不是我**任何一个**地址的那一方」，不是「不是主号」。
test('多邮箱：两个地址都算我，都不当对面', () => {
  const r = classify(msg({ From: `HuDi <${ME2}>`, To: `${ME}, zoe@x.org` }), [ME, ME2])
  assert.equal(r.direction, 'out')
  assert.equal(r.counterpart_email, 'zoe@x.org')

  const r2 = classify(msg({ From: 'zoe@x.org', To: ME2 }), [ME, ME2])
  assert.equal(r2.direction, 'in')
  assert.equal(r2.counterpart_email, 'zoe@x.org')
})

test('只登记了主号时，第二个地址会被当成外人——所以必须一开始就登记全', () => {
  const r = classify(msg({ From: `HuDi <${ME2}>`, To: 'zoe@x.org' }), [ME])
  assert.equal(r.direction, 'in')            // 认不出是我发的
  assert.equal(r.counterpart_email, ME2)     // 于是把自己当成了对面
})

// ── 时间 ────────────────────────────────────────────────────────

test('优先用 internalDate，不信 Date 头', () => {
  const r = classify(msg({ From: 'a@x.com', To: ME, Date: 'Tue, 1 Jan 1999 00:00:00 +0000' }), [ME])
  assert.equal(r.sent_at.slice(0, 10), '2026-07-15')
})

test('没有 internalDate 就退回 Date 头', () => {
  const m = msg({ From: 'a@x.com', To: ME, Date: 'Wed, 12 Aug 2026 09:30:00 +0000' })
  delete m.internalDate
  assert.equal(classify(m, [ME]).sent_at.slice(0, 10), '2026-08-12')
})

test('两个时间都算不出来就整封不要——库里 sent_at 是 not null，不能编', () => {
  const m = msg({ From: 'a@x.com', To: ME })
  delete m.internalDate
  assert.equal(classify(m, [ME]), null)
})

test('认不出发件人的整封不要', () => {
  assert.equal(classify(msg({ To: ME }), [ME]), null)
})

// ── 群发 ────────────────────────────────────────────────────────

test('List-Unsubscribe / List-Id 一出现就是群发', () => {
  assert.equal(isBulk({ 'list-unsubscribe': '<mailto:u@x>' }, 'a@x.com'), true)
  assert.equal(isBulk({ 'list-id': '<news.x.com>' }, 'a@x.com'), true)
})

test('Precedence: bulk / Auto-Submitted 也算', () => {
  assert.equal(isBulk({ precedence: 'bulk' }, 'a@x.com'), true)
  assert.equal(isBulk({ 'auto-submitted': 'auto-generated' }, 'a@x.com'), true)
  assert.equal(isBulk({ 'auto-submitted': 'no' }, 'a@x.com'), false)
})

test('no-reply 那一类地址本身就够', () => {
  for (const e of ['no-reply@x.com', 'noreply@x.com', 'do-not-reply@x.com',
                   'notifications@x.com', 'mailer-daemon@x.com', 'no-reply+123@x.com']) {
    assert.equal(isBulk({}, e), true, e)
  }
})

test('普通人的地址不算群发——replyto@ 不是 no-reply', () => {
  for (const e of ['zoe@x.org', 'hudi.creates@gmail.com', 'replyto@x.com', 'noreplacement@x.com']) {
    assert.equal(isBulk({}, e), false, e)
  }
})

test('群发标记会落到那一行上', () => {
  const r = classify(msg({ From: 'news@x.com', To: ME, 'List-Unsubscribe': '<mailto:u@x>' }), [ME])
  assert.equal(r.bulk, true)
})
