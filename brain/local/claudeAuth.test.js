// brain/local/claudeAuth.test.js —— 用假的 setup-token 走一遍:链接 → 粘码 → 令牌存下;出错有话说
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createClaudeAuth, extractAuthUrl } from './claudeAuth.js'

const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c&state=yB-8uIcC'
const fakeChild = () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = { written: '', write(s) { this.written += s } }; c.kill = () => { c.killed = true; c.emit('exit', 0) }; return c }

test('extractAuthUrl:OSC 8 超链接里的完整链接优先;明文也认', () => {
  const raw = `Browser didn't open?\n\x1b]8;id=q;${URL}\x1b\\https://claude.com/cai/oauth/authorize?code=true&client_id=9d1\x1b]8;;\x1b\\`
  assert.equal(extractAuthUrl(raw), URL)
  assert.equal(extractAuthUrl(`see ${URL} now`), URL)
  assert.equal(extractAuthUrl('nothing'), null)
})

test('登录:起进程拿链接 → 粘码写进假终端 → 令牌交给 onToken,界面只见末四位', async () => {
  const dir = mkdtempSync(`${tmpdir()}/ca-`)
  let child, saved = null
  const auth = createClaudeAuth({ binary: '/x/claude', onToken: (t) => { saved = t }, spawnImpl: (cmd, args) => { assert.equal(cmd, '/usr/bin/expect'); assert.match(args.at(-1), /setup-token/); child = fakeChild(); setTimeout(() => child.stdout.emit('data', Buffer.from(`\x1b]8;id=q;${URL}\x1b\\link\x1b]8;;\x1b\\\nPaste code here if prompted >`)), 10); return child } })
  const v = await auth.start(dir)
  assert.equal(v.authUrl, URL); assert.equal(v.awaitingCode, true)
  const tok = 'sk-ant-oat01-' + 'A'.repeat(60)
  const p = auth.submitCode('abc#yB-8uIcC')
  await new Promise((r) => setTimeout(r, 20)); assert.equal(child.stdin.written, 'abc#yB-8uIcC\n')
  child.stdout.emit('data', Buffer.from(`\x1b[2GYour long-lived token: \x1b[1m${tok}\x1b[0m\n`))
  assert.deepEqual(await p, { connected: true }); assert.equal(saved, tok)
  assert.equal(auth.view().pending, false); assert.equal(JSON.stringify(auth.view()).includes('AAAA'), false)
  rmSync(dir, { recursive: true, force: true })
})

test('码不对:进程退出没令牌 → 带上它最后说的话;没点登录就提交 → 明说', async () => {
  const dir = mkdtempSync(`${tmpdir()}/ca-`)
  let child
  const auth = createClaudeAuth({ binary: '/x/claude', spawnImpl: () => { child = fakeChild(); setTimeout(() => child.stdout.emit('data', Buffer.from(`see ${URL}\n`)), 5); return child } })
  await assert.rejects(auth.submitCode('x'), /先点/)
  await auth.start(dir)
  const p = auth.submitCode('wrong')
  setTimeout(() => { child.stdout.emit('data', Buffer.from('\x1b[31mInvalid authorization code\x1b[0m\n')); child.emit('exit', 1) }, 10)
  await assert.rejects(p, /Invalid authorization code/)
  assert.match(auth.view().error.message, /Invalid/)
  rmSync(dir, { recursive: true, force: true })
})

test('找不到 Claude 程序时说清怎么办', async () => {
  const auth = createClaudeAuth({ binary: null })
  await assert.rejects(auth.start('/tmp'), /setup-token/)
})
