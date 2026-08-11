import { test } from 'node:test'
import assert from 'node:assert/strict'
import { waitForCode } from './auth.js'

const PORT = Number(process.env.GMAIL_CALLBACK_PORT || 8789)
const hit = (path) => fetch(`http://localhost:${PORT}${path}`).then((r) => r.text())

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

test('Google 说不行的时候，当场失败并把原因带出来', async () => {
  const waiting = waitForCode()
  const page = await hit('/?error=access_denied')
  assert.match(page, /access_denied/)
  await assert.rejects(waiting, /access_denied/)
})
