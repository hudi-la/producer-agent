// brain/local/claudeAuth.js —— Claude 订阅一键登录:和 ChatGPT 那颗按钮一样,不用学员开终端。
//
// 原理:包里自带的 Claude 程序(Agent SDK 的平台二进制)本身就能跑 `claude setup-token`。
// 它要一个终端,我们用 macOS 的 `script` 给它一个假终端:它吐出登录链接 → 学员在浏览器里登录、
// 页面给一串码 → 粘回 Fairwind → 我们写进假终端 → 它打出一年期令牌(sk-ant-oat01-…)→ 存进设置。
// 令牌本身永不回给界面,只给末几位。HOME 指到数据目录下的 claude-auth,不碰学员自己的 ~/.claude。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKEN_RE = /sk-ant-oat01-[A-Za-z0-9_-]{40,}/
const strip = (s) => String(s).replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')

/** 找包里那个 claude:开发时在 brain/node_modules,装好的包里在应用根的 node_modules;都没有就用系统装的 */
export function findClaudeBinary() {
  for (const rel of ['../node_modules/@anthropic-ai/', '../../node_modules/@anthropic-ai/']) {
    const dir = fileURLToPath(new URL(rel, import.meta.url))
    if (!existsSync(dir)) continue
    for (const d of readdirSync(dir)) if (d.startsWith('claude-agent-sdk-')) { const bin = join(dir, d, 'claude'); if (existsSync(bin)) return bin }
  }
  for (const p of [join(process.env.HOME || '', '.local/bin/claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude']) if (existsSync(p)) return p
  return null
}

/** 从终端输出里找登录链接:优先 OSC 8 超链接里的那份(完整),没有就找明文 */
export function extractAuthUrl(raw) {
  const m = String(raw).match(/\x1b\]8;[^;]*;(https:\/\/[^\x1b\x07]+)/)
  if (m) return m[1]
  const p = strip(raw).match(/https:\/\/(?:claude\.com|claude\.ai|console\.anthropic\.com)\/[^\s"'<>]*?state=[A-Za-z0-9_-]+/)
  return p ? p[0] : null
}

/**
 * 一个登录会话。spawnImpl / binary 可注入(测试用)。
 * onToken(token) 由调用方存进设置。
 */
export function createClaudeAuth({ spawnImpl = spawn, binary = findClaudeBinary, onToken } = {}) {
  let s = null   // { child, raw, authUrl, pending, error, done, timer }
  const close = (err) => { if (!s) return; clearTimeout(s.timer); s.pending = false; if (err) s.error = err; try { s.child.kill() } catch {} }
  const view = () => ({ pending: Boolean(s?.pending), authUrl: s?.authUrl || null, awaitingCode: Boolean(s?.pending && s?.authUrl), ...(s?.error ? { error: { message: s.error } } : {}) })

  return {
    view,
    /** 起一个 setup-token,等它吐链接(最多 60 秒)。 */
    async start(dataDir) {
      // mac 自带 expect;Linux 服务器(托管)装一个就行(apt install expect)。Windows 没有
      const EXPECT = ['/usr/bin/expect', '/usr/local/bin/expect', '/opt/homebrew/bin/expect'].find((x) => existsSync(x))
      if (process.platform === 'win32' || !EXPECT) throw new Error('一键登录目前只支持 mac 和装了 expect 的 Linux;其他系统在终端里跑 claude setup-token,把令牌粘进来 / One-click sign-in needs mac or Linux with expect; run claude setup-token in a terminal and paste the token')
      const bin = typeof binary === 'function' ? binary() : binary
      if (!bin) throw new Error('找不到 Claude 程序;在终端里跑 claude setup-token,把令牌粘进来 / Claude binary not found; run claude setup-token in a terminal and paste the token')
      close()
      const home = join(dataDir, 'claude-auth'); mkdirSync(home, { recursive: true })
      const env = { HOME: home, PATH: process.env.PATH, USER: process.env.USER, LANG: process.env.LANG || 'en_US.UTF-8', TERM: 'xterm-256color' }
      // 假终端用 mac 自带的 expect 给(script 要求自己的 stdin 也是终端,从程序里起不了);
      // 同时盯两边:Claude 的输出照常转出来(链接、令牌都在里面);我们这边 stdin 来一行码就敲进去。
      // 2026-10-03 起不再「先等它打出 Paste code here 再读码」:那一步在 Linux 上认不准(单词之间是光标控制码、
      // 单行花括号又被当成字面串),码在门外排队到超时。学员能拿到码时 Claude 早就在等了,所以码一到就敲进去。
      const script = String.raw`log_user 1
set bin $env(FW_CLAUDE_BIN)
spawn -noecho /bin/sh -c "stty cols 400 rows 60; exec \"$bin\" setup-token"
set timeout -1
set sid $spawn_id
expect {
  -i $user_spawn_id -re "(\[^\n\]*)\n" { send -i $sid -- "$expect_out(1,string)\r"; exp_continue }
  -i $sid eof { exit 0 }
  -i $sid -re {.+} { exp_continue }
}`
      const child = spawnImpl(EXPECT, ['-c', script], { env: { ...env, FW_CLAUDE_BIN: bin }, stdio: ['pipe', 'pipe', 'pipe'] })
      s = { child, raw: '', authUrl: null, pending: true, error: null, done: false, timer: null }
      const me = s
      const onData = (b) => {
        me.raw += b.toString(); if (me.raw.length > 400_000) me.raw = me.raw.slice(-200_000)
        if (!me.authUrl) me.authUrl = extractAuthUrl(me.raw)
        // 码交上去以后 Claude 说码不对:别干等,当场告诉学员(码过期了 / 复制少了一截最常见)
        if (me.codeSent && !me.saving && !me.failed && /OAuth error/i.test(strip(me.raw.slice(me.codeAt || 0)))) { me.error = '这串码 Claude 不认(可能过期或复制少了),点「登录 Claude」重来一次 / Claude rejected the code (expired or incomplete); sign in again'; me.failed = true }
        const tok = strip(me.raw).match(TOKEN_RE)
        if (tok && !me.done && !me.saving) {
          // 先存(托管版是异步写库),存完才算 done——粘码那次请求要等到「真的存上了」才回话
          me.saving = true; me.pending = false; clearTimeout(me.timer)
          Promise.resolve(onToken?.(tok[0])).then(() => { me.done = true }, (e) => { me.error = e.message; me.failed = true }).finally(() => setTimeout(() => { try { child.kill() } catch {} }, 500))
        }
      }
      child.stdout.on('data', onData); child.stderr.on('data', onData)
      child.on('exit', () => { if (me.pending) { me.pending = false; me.error = me.error || tail(me.raw) || '登录没完成,再试一次 / Sign-in did not complete; try again' } })
      child.on('error', (e) => { me.pending = false; me.error = e.message })
      me.timer = setTimeout(() => { if (me.pending) close('登录超时,再试一次 / Sign-in timed out; try again') }, 10 * 60_000); me.timer.unref?.()
      for (let i = 0; i < 300 && !me.authUrl && me.pending; i++) await new Promise((r) => setTimeout(r, 200))   // 新 HOME 第一次起有个开场动画,链接要等十几秒
      if (!me.authUrl) { const why = me.error || '没拿到登录链接 / No sign-in link came back'; close(why); throw new Error(why) }
      return view()
    },
    /** 学员把页面给的那串码粘回来:写进假终端,等令牌(最多 60 秒)。 */
    async submitCode(code) {
      if (!s?.pending || !s.child) throw new Error('先点「登录 Claude」/ Click "Sign in with Claude" first')
      const c = String(code || '').trim()
      if (!c) throw new Error('把登录页给的那串码粘进来 / Paste the code the sign-in page gave you')
      s.codeAt = s.raw.length; s.codeSent = true
      s.child.stdin.write(c + '\n')   // expect_user 读一行
      const me = s
      for (let i = 0; i < 300 && (me.pending || me.saving) && !me.done && !me.failed; i++) await new Promise((r) => setTimeout(r, 200))
      if (me.done) return { connected: true }
      if (me.failed) { const why = me.error; close(why); throw new Error(why) }
      // 等不到令牌时把它屏幕上最后说了什么带出来(去掉控制码;令牌要是出来了早被上面认走了,这里不会有)
      const last = tail(me.raw)
      if (process.env.FAIRWIND_MODE === 'hosted') console.warn('  · Claude 程序最后的输出:\n' + strip(me.raw).split('\n').map((l) => l.trim()).filter(Boolean).slice(-25).map((l) => '    | ' + l.slice(0, 300)).join('\n'))
      const why = me.error || (me.pending ? '等令牌超时 / Timed out waiting for the token' + (last ? ':' + last : '') : last || '登录没完成 / Sign-in did not complete')
      close(why); throw new Error(why)
    },
    cancel() { close() },
  }
}

/** 出错时给人看的最后几行(去掉控制码、空行、转圈的符号) */
function tail(raw) {
  const lines = strip(raw).split('\n').map((l) => l.trim()).filter((l) => l && !/^[·✢✳✶✻✽]+$/.test(l) && !/^Paste code here/.test(l))
  return lines.slice(-2).join(' · ').slice(0, 240)
}
