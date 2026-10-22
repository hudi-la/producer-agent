import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeGmailConnect } from './webauth.js'
import { SCOPES, client, MailAuthError } from './auth.js'
import { withTenant } from '../tenant.js'

function fakeClient({ tokens } = {}) {
  return {
    generateAuthUrl: (o) => `https://accounts.google.com/o/oauth2/v2/auth?state=${o.state}&access_type=${o.access_type}&prompt=${o.prompt}&scope=${encodeURIComponent(o.scope.join(' '))}${o.login_hint ? '&login_hint=' + o.login_hint : ''}`,
    getToken: async () => ({ tokens }),
    setCredentials: () => {},
    revokeToken: async () => {},
  }
}

test('start → take:state 认得出是谁,用一次作废;过期的认不出', () => {
  let t = 0
  const g = makeGmailConnect({ now: () => t, makeClient: () => fakeClient() })
  const { url, state } = g.start('owner-a', { loginHint: 'a@x.com' })
  assert.match(url, /access_type=offline/); assert.match(url, /prompt=consent/); assert.match(url, /login_hint=a@x.com/)
  assert.equal(g.take(state), 'owner-a')
  assert.equal(g.take(state), null, '第二次就不认了')
  assert.equal(g.take('made-up'), null)
  const s2 = g.start('owner-b').state
  t = 11 * 60 * 1000
  assert.equal(g.take(s2), null, '十分钟过了就不认了')
})

test('exchange:每一格都勾才算;拿到地址和长期钥匙', async () => {
  const ok = makeGmailConnect({ makeClient: () => fakeClient({ tokens: { refresh_token: 'rt', scope: SCOPES.join(' ') } }), profileOf: async () => 'a@gmail.com' })
  assert.deepEqual(await ok.exchange('c'), { address: 'a@gmail.com', refreshToken: 'rt' })
  const half = makeGmailConnect({ makeClient: () => fakeClient({ tokens: { refresh_token: 'rt', scope: SCOPES[0] } }), profileOf: async () => 'a@gmail.com' })
  await assert.rejects(half.exchange('c'), /发信、建草稿/)
  const noRt = makeGmailConnect({ makeClient: () => fakeClient({ tokens: { scope: SCOPES.join(' ') } }), profileOf: async () => 'a@gmail.com' })
  await assert.rejects(noRt.exchange('c'), MailAuthError)
})

test('client():线上按租户拿钥匙,没连就是授权错;同一把钥匙复用同一个客户端', async () => {
  const save = { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET, origin: process.env.BRAIN_ORIGIN }
  process.env.GMAIL_CLIENT_ID = 'cid'; process.env.GMAIL_CLIENT_SECRET = 'sec'; process.env.BRAIN_ORIGIN = 'https://fw.example'
  try {
    const none = { mode: 'hosted', settings: {}, marks: {} }
    await withTenant(none, async () => {
      const e = await client().catch((x) => x)
      assert.ok(e instanceof MailAuthError)
      assert.match(e.fix, /设置/)
    })
    const a = { mode: 'hosted', settings: { gmailRefreshToken: 'rt-a', gmailAddress: 'a@gmail.com' }, marks: {} }
    const b = { mode: 'hosted', settings: { gmailRefreshToken: 'rt-b', gmailAddress: 'b@gmail.com' }, marks: {} }
    const [ca1, ca2, cb] = await Promise.all([withTenant(a, client), withTenant(a, client), withTenant(b, client)])
    assert.equal(ca1, ca2)
    assert.notEqual(ca1, cb)
    assert.equal(ca1.credentials.refresh_token, 'rt-a')
    assert.equal(cb.credentials.refresh_token, 'rt-b')
    assert.equal(ca1.redirectUri, 'https://fw.example/oauth/gmail/callback')
  } finally {
    for (const [k, v] of [['GMAIL_CLIENT_ID', save.id], ['GMAIL_CLIENT_SECRET', save.secret], ['BRAIN_ORIGIN', save.origin]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
})
