import test from 'node:test'
import assert from 'node:assert/strict'
import { assertSameMailbox, sendLetter } from './send.js'

const gmailThat = (impl) => ({ users: { messages: { send: impl } } })
const ok = (calls) => gmailThat(async (a) => {
  calls.push(a)
  return { data: { id: 'm1', threadId: 't1' } }
})

test('授权的账号跟画像里填的不是同一个，当场拒发', () => {
  assert.throws(() => assertSameMailbox('a@x.com', 'b@y.com'), /不是同一个/)
})

test('大小写和空格不算不一致', () => {
  assert.doesNotThrow(() => assertSameMailbox('A@X.com', ' a@x.com '))
})

test('画像里没填邮箱就别拦——拦了等于没填过画像的人一封都发不出去', () => {
  assert.doesNotThrow(() => assertSameMailbox('a@x.com', null))
  assert.doesNotThrow(() => assertSameMailbox('a@x.com', ''))
})

test('发出去之后交出 gmail id、thread id 和我们自己生成的 Message-ID', async () => {
  const calls = []
  const out = await sendLetter({
    gmail: ok(calls), from: 'me@x.com', fromName: 'Hu Di', to: 'ana@y.org',
    subject: '你好', body: '**在**',
  })
  assert.equal(out.id, 'm1')
  assert.equal(out.threadId, 't1')
  assert.match(out.messageId, /^<[0-9a-f-]{36}@x\.com>$/)
  assert.equal(calls[0].userId, 'me')
  assert.ok(calls[0].requestBody.raw.length > 0)
})

test('正文两份都发出去了——粗体不能变成四个星号', async () => {
  const calls = []
  await sendLetter({ gmail: ok(calls), from: 'me@x.com', to: 'a@b.c', subject: 's', body: '**在**' })
  const mime = Buffer.from(
    calls[0].requestBody.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  assert.match(mime, /text\/plain/)
  assert.match(mime, /text\/html/)
  assert.ok(mime.includes(Buffer.from('<p><strong>在</strong></p>\n', 'utf8').toString('base64')))
})

test('给了 threadId 就挂回那一串', async () => {
  const calls = []
  await sendLetter({ gmail: ok(calls), from: 'me@x.com', to: 'a@b.c', subject: 's', body: 'b', threadId: 't9' })
  assert.equal(calls[0].requestBody.threadId, 't9')
})

test('没给 threadId 就不许带这个字段——带一个空的会被当成挂到空串上', async () => {
  const calls = []
  await sendLetter({ gmail: ok(calls), from: 'me@x.com', to: 'a@b.c', subject: 's', body: 'b' })
  assert.ok(!('threadId' in calls[0].requestBody))
})

test('超时一律不重试——那封信可能已经出去了', async () => {
  let n = 0
  const gmail = gmailThat(async () => {
    n++
    const e = new Error('socket hang up'); e.code = 'ETIMEDOUT'; throw e
  })
  await assert.rejects(
    () => sendLetter({ gmail, from: 'me@x.com', to: 'a@b.c', subject: 's', body: 'b' }),
    /可能已经发出去了/)
  assert.equal(n, 1, '只许试一次')
})

test('5xx 也不重试，同一条理由', async () => {
  let n = 0
  const gmail = gmailThat(async () => {
    n++
    const e = new Error('boom'); e.response = { status: 503 }; throw e
  })
  await assert.rejects(
    () => sendLetter({ gmail, from: 'me@x.com', to: 'a@b.c', subject: 's', body: 'b' }),
    /可能已经发出去了/)
  assert.equal(n, 1)
})

test('授权掉了要认得出来，不能长成一句普通网络错', async () => {
  const gmail = gmailThat(async () => {
    const e = new Error('invalid_grant'); e.response = { status: 401 }; throw e
  })
  await assert.rejects(
    () => sendLetter({ gmail, from: 'me@x.com', to: 'a@b.c', subject: 's', body: 'b' }),
    (e) => e.name === 'MailAuthError')
})

test('Gmail 没回 message id 就当没发成——那封信的下落必须说清楚', async () => {
  const gmail = gmailThat(async () => ({ data: {} }))
  await assert.rejects(
    () => sendLetter({ gmail, from: 'me@x.com', to: 'a@b.c', subject: 's', body: 'b' }),
    /下落不明/)
})

test('收件人里塞换行发不出去——注入拦在 mime 那层，这儿确认它真能冒上来', async () => {
  const calls = []
  await assert.rejects(() => sendLetter({
    gmail: ok(calls), from: 'me@x.com', to: 'a@b.c\nBcc: evil@x.com', subject: 's', body: 'b',
  }), /换行/)
  assert.equal(calls.length, 0, '一个字节都不许发出去')
})
