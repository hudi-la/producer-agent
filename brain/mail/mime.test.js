import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeHeader, newMessageId, buildMime, toRaw } from './mime.js'

const BASE = {
  from: 'me@example.com', fromName: 'Hu Di', to: 'ana@x.org',
  subject: 'Re: 驻地', text: '你好', html: '<p>你好</p>',
  messageId: '<abc@example.com>',
  date: new Date('2026-08-16T10:00:00Z'), boundary: 'B0UND',
}

test('纯 ASCII 的头原样不动', () => {
  assert.equal(encodeHeader('Re: residency'), 'Re: residency')
})

test('带中文的头走 RFC 2047，不是原样塞进去', () => {
  const got = encodeHeader('回复：驻地')
  assert.match(got, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
  assert.equal(Buffer.from(got.slice(10, -2), 'base64').toString('utf8'), '回复：驻地')
})

test('Message-ID 用发信地址的域名', () => {
  assert.match(newMessageId('me@example.com'), /^<[0-9a-f-]{36}@example\.com>$/)
})

test('Message-ID 每次都不一样——重了就等于两封信在库里撞成一封', () => {
  assert.notEqual(newMessageId('me@x.com'), newMessageId('me@x.com'))
})

test('两份正文都在，纯文本在前', () => {
  const m = buildMime(BASE)
  assert.match(m, /Content-Type: multipart\/alternative; boundary="B0UND"/)
  const plainAt = m.indexOf('text/plain')
  const htmlAt = m.indexOf('text/html')
  assert.ok(plainAt > 0 && htmlAt > plainAt, '纯文本必须排在 html 前面')
  assert.match(m, /--B0UND--\r\n$/)
})

test('正文用 base64 编，中文不会被截断成乱码', () => {
  const m = buildMime(BASE)
  const part = m.split('--B0UND')[1]
  assert.match(part, /Content-Transfer-Encoding: base64/)
  const b64 = part.trim().split(/\r?\n/).pop().trim()
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), '你好')
})

test('发信人有名字就用「名字 <地址>」，名字也得编码', () => {
  assert.match(buildMime({ ...BASE, fromName: '胡迪' }), /From: =\?UTF-8\?B\?[^?]+\?= <me@example\.com>/)
  assert.match(buildMime({ ...BASE, fromName: null }), /From: me@example\.com\r\n/)
})

test('回信带 In-Reply-To 和 References——0055 靠它认亲', () => {
  const m = buildMime({ ...BASE, inReplyTo: '<x@y>', refs: ['<w@y>', '<x@y>'] })
  assert.match(m, /In-Reply-To: <x@y>/)
  assert.match(m, /References: <w@y> <x@y>/)
})

test('新起一封就不许有这两个头——空的 In-Reply-To 会让对方客户端挂错串', () => {
  const m = buildMime(BASE)
  assert.doesNotMatch(m, /In-Reply-To:/)
  assert.doesNotMatch(m, /References:/)
})

test('头里塞换行的一律拒——那是往信头里注入别的头', () => {
  assert.throws(() => buildMime({ ...BASE, subject: '正常\r\nBcc: evil@x.com' }), /换行/)
  assert.throws(() => buildMime({ ...BASE, to: 'a@b.c\nBcc: evil@x.com' }), /换行/)
  assert.throws(() => buildMime({ ...BASE, fromName: 'Hu\nDi' }), /换行/)
  assert.throws(() => buildMime({ ...BASE, inReplyTo: '<x@y>\nBcc: e@x' }), /换行/)
})

test('注入拒得掉，不是「清理掉」——静悄悄删的话你不知道信发给了谁', () => {
  try {
    buildMime({ ...BASE, subject: 'a\r\nBcc: evil@x.com' })
    assert.fail('该抛的没抛')
  } catch (e) {
    assert.match(e.message, /主题/)
  }
})

test('头和正文之间必须空一行，否则整封信会被当成头', () => {
  assert.match(buildMime(BASE), /Content-Type: multipart\/alternative[^\r]*\r\n\r\n--B0UND/)
})

test('raw 是 base64url，不带 + / =', () => {
  const raw = toRaw(buildMime(BASE))
  assert.doesNotMatch(raw, /[+/=]/)
})

test('raw 解回来就是原来那封信，一个字节不差', () => {
  const m = buildMime(BASE)
  const back = Buffer.from(toRaw(m).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  assert.equal(back, m)
})

test('行尾一律 CRLF —— 只有 \\n 的信头有的邮件服务器不认', () => {
  const m = buildMime(BASE)
  assert.doesNotMatch(m.replace(/\r\n/g, ''), /\n/)
})

// ── 收件人是一份名单（2026-08-18）────────────────────────────
//
// 起因：Huntington 那封要回给两个人，而 To 只放得下一个，Cc 根本没有。
// 「不确定是几个人」就没法安心按发送——那等于这个功能没做。

test('To 收一份名单，逗号分开', () => {
  const m = buildMime({ ...BASE, to: ['a@x.org', 'b@y.org'] })
  assert.match(m, /^To: a@x\.org, b@y\.org$/m)
})

test('单个字符串照旧认——老产出里的 to 就是字符串', () => {
  assert.match(buildMime({ ...BASE, to: 'a@x.org' }), /^To: a@x\.org$/m)
})

test('抄送写成 Cc 头；没有就一个字都不出现', () => {
  assert.match(buildMime({ ...BASE, cc: ['c@z.org'] }), /^Cc: c@z\.org$/m)
  assert.doesNotMatch(buildMime(BASE), /^Cc:/m)
  assert.doesNotMatch(buildMime({ ...BASE, cc: [] }), /^Cc:/m)
})

test('一个收件人都没有就当场拒——空名单的信发出去谁也收不到', () => {
  assert.throws(() => buildMime({ ...BASE, to: [] }), /收件人/)
  assert.throws(() => buildMime({ ...BASE, to: '' }), /收件人/)
})

test('名单里任何一个塞了换行都拒，不是只查第一个', () => {
  assert.throws(() => buildMime({ ...BASE, to: ['ok@x.org', 'e@y.org\nBcc: evil@z'] }), /换行/)
  assert.throws(() => buildMime({ ...BASE, cc: ['e@y.org\nBcc: evil@z'] }), /换行/)
})
