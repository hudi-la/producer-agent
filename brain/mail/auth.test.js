import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { waitForCode } from './auth.js'

const PORT = Number(process.env.GMAIL_CALLBACK_PORT || 8789)
// These tests restart the callback listener on the same port. Do not reuse an
// undici connection to the previous listener (intermittent ECONNRESET under load).
const hit = (path) => hitKeepAlive(path, false)

/** 像浏览器那样请求：keep-alive，回完不主动断开。 */
function hitKeepAlive(path, agent) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path, agent }, (res) => {
      let body = ''
      res.on('data', (d) => { body += d })
      res.on('end', () => resolve(body))
    })
    req.on('error', reject)
  })
}

// 这条是为一个真的 bug 写的回归测试。
//
// 原来的实现是「有任何请求进来就 close + reject」。于是浏览器顺手要一下
// /favicon.ico、或者你自己手抖打开一次 localhost:8789，整个授权流程就当场
// 被打断——而 Google 随后的重定向扑空，报出来的还是「没带回 code」，
// 根本查不到根上。
test('闲杂请求不打断授权：手动访问过一次之后，照样能收到 code', async () => {
  const waiting = waitForCode()

  const idle = await hit('/')
  assert.match(idle, /还在等 Google 把你送回来/)

  const fav = await hit('/favicon.ico')
  assert.match(fav, /还在等 Google 把你送回来/)

  // 服务还活着，Google 这时候才把人送回来
  const done = await hit('/?code=THE_CODE&scope=gmail.readonly')
  assert.match(done, /可以关掉这个页面/)

  assert.equal(await waiting, 'THE_CODE')
})

// 这条是为**上一条修复引入的新 bug** 写的。
//
// server.close(cb) 的回调要等所有连接断开才触发，而浏览器保着 keep-alive
// 不放。于是真跑的时候：code 收到了、端口不监听了、进程却永远卡着——
// 表现成「点完同意就没反应」。上一条测试用 fetch，连接关得快，漏掉了。
//
// 判据是**必须在几秒内 resolve**，不是「最终会 resolve」。
test('浏览器保着长连接也要能收工，不能卡死', async () => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
  let timeout
  try {
    const waiting = waitForCode()
    await hitKeepAlive('/', agent)                       // 先来一发闲杂的，连接留着
    await hitKeepAlive('/?code=KEEPALIVE_CODE', agent)   // 再送 code，连接**还留着**

    const code = await Promise.race([
      waiting,
      new Promise((_, rej) => { timeout = setTimeout(() => rej(new Error('卡住了：5 秒没 resolve')), 5000) }),
    ])
    assert.equal(code, 'KEEPALIVE_CODE')
  } finally {
    clearTimeout(timeout)
    agent.destroy()
  }
})

test('Google 说不行的时候，当场失败并把原因带出来', async () => {
  // 先把 catch 挂上再发请求：修好卡死之后 reject 来得很快，
  // 用 assert.rejects(waiting) 会赶不及，报成 unhandled rejection。
  const waiting = waitForCode().then(() => null, (e) => e)
  const page = await hit('/?error=access_denied')
  assert.match(page, /access_denied/)

  const err = await waiting
  assert.ok(err, '本该失败的')
  assert.match(err.message, /access_denied/)
})

import { asAuthErrorIfItIs, MailAuthError as MAE } from './auth.js'
test('403 限流不是授权掉了;真的掉了要把 Google 的原话带出来', () => {
  const api = (status, reason, message) => Object.assign(new Error('x'), { response: { status, data: { error: { code: status, message, errors: [{ reason }] } } } })
  const rl = api(403, 'userRateLimitExceeded', 'User-rate limit exceeded')
  assert.equal(asAuthErrorIfItIs(rl), rl)
  const scopeError = api(403, 'insufficientPermissions', 'Request had insufficient authentication scopes.')
  const denied = asAuthErrorIfItIs(scopeError)
  assert.ok(denied instanceof MAE)
  // UI intentionally explains missing scopes rather than claiming all auth is lost.
  assert.match(denied.message, /未授予此操作所需权限/)
  assert.equal(denied.cause, scopeError) // Raw provider evidence remains available for diagnostics.
  assert.doesNotMatch(denied.message, /授权掉了/)
  assert.doesNotMatch(denied.message, /object Object/)
  const grant = asAuthErrorIfItIs(Object.assign(new Error('x'), { response: { status: 400, data: { error: 'invalid_grant' } } }))
  assert.match(grant.message, /invalid_grant/)
})
