// 线上「连接 Gmail」那一来一回(设计稿 2026-10-06 D4)。
//
// 本机版是终端里跑 `npm run mail:auth`、回调到 localhost(auth.js 的 authorize)。线上没有终端:
//   ① 页面按「连接 Gmail」→ start(owner) 发一串随机 state,记下「这串是谁按的」→ 回 Google 的授权网址
//   ② 浏览器整页跳 Google,同意,Google 把人送回 /oauth/gmail/callback?code&state
//   ③ 回调**不带登录身份**(是 Google 送回来的整页跳转),只能靠 state 认人:take(state) → owner
//   ④ exchange(code) → 地址 + 长期钥匙,由 server.js 在那个人的身份下存进库
//
// state 只活在这个进程的内存里,10 分钟过期、用一次就作废。进程重启了,正在授权的人重按一次就好——
// 一个进程伺候所有人(托管设计稿),不需要再进库。
import { randomBytes } from 'node:crypto'
import { google } from 'googleapis'
import { webClient, SCOPES, MailAuthError } from './auth.js'

const TTL_MS = 10 * 60 * 1000

async function defaultProfileOf(c) {
  const { data } = await google.gmail({ version: 'v1', auth: c }).users.getProfile({ userId: 'me' })
  return String(data.emailAddress || '').toLowerCase()
}

export function makeGmailConnect({ now = () => Date.now(), makeClient = webClient, profileOf = defaultProfileOf } = {}) {
  const pending = new Map()   // state → { owner, at }
  const sweep = () => { for (const [k, v] of pending) if (now() - v.at > TTL_MS) pending.delete(k) }

  /** 发一串 state,回 Google 授权网址。loginHint = 他登录用的邮箱,Google 那页会先选上它(能换) */
  function start(owner, { loginHint } = {}) {
    if (!owner) throw new Error('没认出是谁')
    sweep()
    const state = randomBytes(24).toString('hex')
    pending.set(state, { owner, at: now() })
    const url = makeClient().generateAuthUrl({
      access_type: 'offline',   // 要长期钥匙
      prompt: 'consent',        // 每次都重新给长期钥匙(不加的话,授权过一次的人第二次拿不到)
      scope: SCOPES,
      state,
      ...(loginHint ? { login_hint: loginHint } : {}),
    })
    return { url, state }
  }

  /** state → owner;认不出或过期 → null。用一次就作废 */
  function take(state) {
    sweep()
    const p = state ? pending.get(state) : null
    if (!p) return null
    pending.delete(state)
    return p.owner
  }

  /** 换码:→ { address, refreshToken }。Google 那页每样权限一个勾(读信、发信、建草稿),少勾一个就说清楚 */
  async function exchange(code) {
    const c = makeClient()
    const { tokens } = await c.getToken(code)
    const granted = String(tokens.scope || '').split(/\s+/)
    const missing = SCOPES.filter((s) => !granted.includes(s))
    if (missing.length) {
      const what = missing.map((s) => (s.endsWith('.send') ? '发信' : s.endsWith('.compose') ? '建草稿' : '读信')).join('、')
      throw new MailAuthError(`Google 那页「${what}」那一格没勾上——重新连一次,每一格都勾上 / Please tick every box (read, send, drafts) on Google's page`)
    }
    if (!tokens.refresh_token) throw new MailAuthError('Google 没给长期钥匙——重新连一次 / Google did not return a long-lived token; please try again')
    c.setCredentials(tokens)
    const address = await profileOf(c)
    if (!address) throw new MailAuthError('Google 没说这是哪个信箱 / Could not read the mailbox address')
    return { address, refreshToken: tokens.refresh_token }
  }

  /** 断开时顺手在 Google 那边撤销;撤销失败不拦(库里的钥匙照样清掉) */
  async function revoke(refreshToken) {
    if (!refreshToken) return
    try { await makeClient().revokeToken(refreshToken) } catch (e) { console.warn('  ⚠️ Google 那边撤销没成(库里已经清掉):' + e.message) }
  }

  return { start, take, exchange, revoke, _pending: pending }
}
