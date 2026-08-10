// Gmail 的钥匙。
//
// 为什么 brain 自己拿 OAuth，而不是继续走 claude.ai 那个 Gmail 连接器：
// 连接器的工具**只有模型能调**，于是每取一批信都要花一次模型往返，抓取和
// 理解焊死在一起。65 条线里只有 3 条登记过 thread，就是这么卡住的。
// brain 是跑在本机的 Node 进程，它可以自己拿凭证——这一步之后，抓取变成
// 纯 HTTP，模型只在真需要判断的地方出场。
//
// scope 只有 gmail.readonly。**这个系统本来就发不出信**（草稿走的是另一条
// 路，而且 claude.ai 那套工具里根本没有 send），不给写权限，这条护栏就
// 不是嘱咐，是结构上做不到。
//
// ── 一个必须踩对的坑 ──────────────────────────────────────────
// Google 的 OAuth 同意屏幕如果停在 **Testing**，发下来的 refresh token
// **7 天就过期**。对一个天天在用的系统，那等于每周挂一次。
// 发布状态必须设成 **In production**（未经验证也行，自己用会看到一个
// 警告页，点「高级 → 继续」就过去了）。详见 README。

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { google } from 'googleapis'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKENS = path.join(HERE, '..', '.mail-tokens.json')

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
const CALLBACK_PORT = 8789          // brain 自己是 8788，别撞上

/**
 * 授权掉了要认得出来。
 *
 * 这次事故里最伤人的一半，是 handleSync 明明返回了一句实话而 runRefresh
 * 把它丢了——进度条走完，屏幕上一点动静没有，看起来像坏了。授权失效
 * 绝对不能长成「这轮 0 封新信」的样子，所以它有自己的错误类型。
 */
export class MailAuthError extends Error {
  constructor(msg, cause) {
    super(msg)
    this.name = 'MailAuthError'
    this.cause = cause
    this.fix = '在 brain 目录下跑一次 `npm run mail:auth` 重新授权'
  }
}

function creds() {
  const id = process.env.GMAIL_CLIENT_ID
  const secret = process.env.GMAIL_CLIENT_SECRET
  if (!id || !secret) {
    throw new MailAuthError(
      'brain/.env 里还没有 GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET。' +
      '按 brain/README.md 里「接上 Gmail」那节，在 Google Cloud 建一个 Desktop app 的 OAuth 客户端。')
  }
  return { id, secret }
}

function newClient() {
  const { id, secret } = creds()
  return new google.auth.OAuth2(id, secret, `http://localhost:${CALLBACK_PORT}`)
}

export function hasTokens() {
  return fs.existsSync(TOKENS)
}

function readTokens() {
  if (!hasTokens()) {
    throw new MailAuthError('还没授权过 Gmail（找不到 brain/.mail-tokens.json）')
  }
  try {
    return JSON.parse(fs.readFileSync(TOKENS, 'utf8'))
  } catch (err) {
    throw new MailAuthError('brain/.mail-tokens.json 读不了，多半是坏了', err)
  }
}

function writeTokens(t) {
  // 0600：这是一把能读你全部邮件的钥匙，别让同机器上别的用户看见。
  fs.writeFileSync(TOKENS, JSON.stringify(t, null, 2), { mode: 0o600 })
}

/**
 * 拿一个已经授权好的客户端。
 *
 * refresh token 由 googleapis 自己续，续到新的就落盘——不落盘的话进程一重启
 * 又得重新授权，而重新授权是要你人在场点浏览器的，那就没法无人值守了。
 */
export async function client() {
  const c = newClient()
  const saved = readTokens()
  if (!saved.refresh_token) {
    throw new MailAuthError('存下来的凭证里没有 refresh_token —— 得重新授权一次')
  }
  c.setCredentials(saved)
  c.on('tokens', (t) => {
    // Google 只在第一次授权时给 refresh_token，后续刷新不带，所以要合并保存
    writeTokens({ ...saved, ...t, refresh_token: t.refresh_token || saved.refresh_token })
  })
  return c
}

/** 已经授权的那个 Gmail 账号是谁。顺带当一次连通性自检。 */
export async function whoami() {
  const gmail = google.gmail({ version: 'v1', auth: await client() })
  try {
    const { data } = await gmail.users.getProfile({ userId: 'me' })
    return { address: String(data.emailAddress || '').toLowerCase(),
             total: Number(data.messagesTotal || 0),
             historyId: String(data.historyId || '') }
  } catch (err) {
    throw asAuthErrorIfItIs(err)
  }
}

/**
 * 把 Google 的报错翻译成「这是授权掉了」还是「这是别的毛病」。
 *
 * 授权会掉的几种情况，README 里也写着：
 *   · 你改了 Google 密码（**带 Gmail scope 的 token 必失效**，最容易撞上）
 *   · 6 个月没用过
 *   · 你主动撤销了授权
 *   · 同意屏幕停在 Testing（那是 7 天一次，见文件顶部）
 */
export function asAuthErrorIfItIs(err) {
  const code = err?.response?.status ?? err?.code
  const body = String(err?.response?.data?.error || err?.message || '')
  if (code === 401 || code === 403 || /invalid_grant|invalid_token|unauthorized/i.test(body)) {
    return new MailAuthError(`Gmail 授权掉了（${body || code}）`, err)
  }
  return err
}

/**
 * 走一次授权：起本地回调 → 开浏览器 → 换 token → 落盘。
 * 只有 `npm run mail:auth` 会调它，服务端跑的时候永远不会走到这儿。
 */
export async function authorize() {
  const c = newClient()
  const url = c.generateAuthUrl({
    access_type: 'offline',      // 要 refresh token
    prompt: 'consent',           // 强制再给一次 refresh token（不加的话第二次授权拿不到）
    scope: SCOPES,
  })

  console.log('\n在浏览器里打开这个地址完成授权：\n')
  console.log('  ' + url + '\n')
  console.log('（看到「Google 尚未验证此应用」是正常的——这就是你自己的应用。')
  console.log('  点「高级」→「继续前往」。）\n')

  // 尽量替你打开
  const { spawn } = await import('node:child_process')
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try { spawn(opener, [url], { stdio: 'ignore', detached: true }).unref() } catch (_) {}

  const code = await waitForCode()
  const { tokens } = await c.getToken(code)
  if (!tokens.refresh_token) {
    throw new MailAuthError(
      'Google 没给 refresh_token。多半是这个账号之前授权过——去 ' +
      'https://myaccount.google.com/permissions 把这个应用移除，再跑一次。')
  }
  writeTokens(tokens)

  c.setCredentials(tokens)
  const gmail = google.gmail({ version: 'v1', auth: c })
  const { data } = await gmail.users.getProfile({ userId: 'me' })
  return { address: String(data.emailAddress || '').toLowerCase(),
           total: Number(data.messagesTotal || 0) }
}

function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${CALLBACK_PORT}`)
      const code = u.searchParams.get('code')
      const err = u.searchParams.get('error')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(code
        ? '<h2>好了，可以关掉这个页面回终端了。</h2>'
        : `<h2>授权没成：${err || '不知道为什么'}</h2>`)
      server.close()
      if (code) resolve(code)
      else reject(new MailAuthError(`授权没成：${err || '浏览器没带回 code'}`))
    })
    server.on('error', (e) => reject(new MailAuthError(
      `本地回调口 ${CALLBACK_PORT} 起不来（${e.message}）——是不是已经有一个在跑了？`, e)))
    server.listen(CALLBACK_PORT, () => {
      console.log(`等着浏览器回调（localhost:${CALLBACK_PORT}）…\n`)
    })
    // 五分钟没动静就别挂着了
    setTimeout(() => { server.close(); reject(new MailAuthError('等授权等了五分钟，先算了')) }, 5 * 60 * 1000)
  })
}
