// 脑子那一层的隔离测试(设计稿 2026-10-02 验收 3):库的隔离 isolation-test.mjs 已经证过,
// 这个证的是**托管的脑子**不会把一个人的东西递给另一个人——每条路都带着浏览器的 JWT 或 MCP 令牌,
// 脑子按它认人、按人建上下文;认错一次就是泄露,而且静默。
//
//   两个测试账号各写一个标记串(档案的名字、一条判据、一张机会卡),然后:
//   · 没带身份 → 每条路都 401(/health 和静态页除外)
//   · 以 A 的 JWT 调每条路 → 响应里没有 B 的标记;反过来一遍
//   · 以 A 的 MCP 令牌调 /mcp 的读工具 → 只见 A;B 的令牌只见 B;瞎编的令牌 401
//   · /settings 的回显里没有完整的 key
//
// 跑法:HOSTED_URL=https://fairwind.xxx SUPABASE_URL=… SUPABASE_ANON_KEY=… ISO_A=a@x:密码 ISO_B=b@x:密码 node scripts/isolation-brain.mjs
// 不碰模型:不调 /chat /brief 这些要花钱的路(它们跟其他路走同一道认人的门,门对了就对了)。
import { createClient } from '@supabase/supabase-js'

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`缺 ${k}`); process.exit(2) } return v }
const HOSTED = need('HOSTED_URL').replace(/\/$/, '')
const URL_ = need('SUPABASE_URL'), ANON = need('SUPABASE_ANON_KEY')
const [emailA, passA] = need('ISO_A').split(':'), [emailB, passB] = need('ISO_B').split(':')

let 失败 = []
const fail = (m) => { 失败.push(m); console.log('  ✗ ' + m) }
const ok = (m) => console.log('  ✓ ' + m)

async function login(email, password) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`${email} 登不进:${error.message}`)
  return { email, jwt: data.session.access_token, uid: data.user.id, mark: `ISO_${email.split('@')[0].toUpperCase()}_${Math.random().toString(36).slice(2, 8)}` }
}
const call = async (path, { jwt, token, method = 'GET', body } = {}) => {
  const headers = { 'content-type': 'application/json' }
  if (jwt) headers.authorization = `Bearer ${jwt}`
  if (token) headers.authorization = `Bearer ${token}`
  const r = await fetch(HOSTED + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  return { status: r.status, text }
}

/** 一次 MCP 调用(Streamable HTTP,无状态) */
async function mcp(token, method, params = {}) {
  const r = await fetch(HOSTED + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const text = await r.text()
  return { status: r.status, text }
}

async function seed(u) {
  // 标记进档案名、判据、一条设置;机会卡走库(前端那条路)——这里只验脑子,库那边 isolation-test.mjs 管
  let r = await call('/settings', { jwt: u.jwt, method: 'POST', body: { model: `m-${u.mark}`, lang: 'zh' } })
  if (r.status !== 200) fail(`${u.email} 写设置:${r.status} ${r.text.slice(0, 100)}`)
  r = await call('/judgments/files', { jwt: u.jwt, method: 'POST', body: { file: '全部.md', content: `判据 ${u.mark}` } })
  if (r.status !== 200) fail(`${u.email} 写判据:${r.status} ${r.text.slice(0, 100)}`)
  const s = await call('/settings', { jwt: u.jwt })
  u.mcpToken = JSON.parse(s.text).mcpToken
  if (!u.mcpToken) fail(`${u.email} 没拿到 MCP 令牌`)
  const c = createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${u.jwt}` } }, auth: { persistSession: false } })
  const { error } = await c.rpc('pa_set_profile', { p_name: u.mark })
  if (error) fail(`${u.email} 写档案:${error.message}`)
}

const GETS = ['/me', '/settings', '/modules', '/judgments/files', '/health']
const POSTS = [['/modules', {}], ['/judgments/preview', { n: 1 }], ['/chat/stop', { run_id: 'x' }], ['/identify', { email: 'nobody@x.test' }]]

async function sweepAs(me, other) {
  for (const p of GETS) {
    const r = await call(p, { jwt: me.jwt })
    if (r.status >= 500) fail(`${me.email} GET ${p} 炸了:${r.status}`)
    if (r.text.includes(other.mark)) fail(`${me.email} GET ${p} 看见了 ${other.email} 的标记`)
  }
  for (const [p, body] of POSTS) {
    const r = await call(p, { jwt: me.jwt, method: 'POST', body })
    if (r.text.includes(other.mark)) fail(`${me.email} POST ${p} 看见了 ${other.email} 的标记`)
  }
  // 自己的得看得见——空空如也的绿不算证明
  const mine = await call('/judgments/files', { jwt: me.jwt })
  if (!mine.text.includes(me.mark)) fail(`${me.email} 看不见自己的判据`)
  const s = JSON.parse((await call('/settings', { jwt: me.jwt })).text)
  if (s.model !== `m-${me.mark}`) fail(`${me.email} 的设置不是自己的`)
  for (const k of ['apiKey', 'oauthToken', 'openaiKey', 'geminiKey']) if (k in s) fail(`/settings 回显了完整的 ${k}`)
  // MCP:读工具只见自己
  const tools = await mcp(me.mcpToken, 'tools/list')
  if (tools.status !== 200) fail(`${me.email} MCP tools/list:${tools.status}`)
  for (const tool of ['fairwind_profile_get', 'fairwind_judgments_list', 'fairwind_entries_list']) {
    const r = await mcp(me.mcpToken, 'tools/call', { name: tool, arguments: {} })
    if (r.text.includes(other.mark)) fail(`${me.email} MCP ${tool} 看见了 ${other.email} 的标记`)
  }
  const prof = await mcp(me.mcpToken, 'tools/call', { name: 'fairwind_profile_get', arguments: {} })
  if (!prof.text.includes(me.mark)) fail(`${me.email} MCP 看不见自己的档案`)
  ok(`${me.email}:每条路只见自己`)
}

async function main() {
  console.log('登录两个测试账号')
  const A = await login(emailA, passA), B = await login(emailB, passB)
  if (A.uid === B.uid) { console.error('两个账号是同一个人'); process.exit(2) }
  console.log('种标记'); await seed(A); await seed(B)

  console.log('没带身份')
  for (const p of GETS.filter((x) => x !== '/health')) { const r = await call(p); if (r.status !== 401) fail(`没身份 GET ${p} 回了 ${r.status}`) }
  for (const [p, body] of POSTS) { const r = await call(p, { method: 'POST', body }); if (r.status !== 401) fail(`没身份 POST ${p} 回了 ${r.status}`) }
  { const r = await call('/health'); if (r.status !== 200) fail(`/health 没身份该 200,回了 ${r.status}`) }
  { const r = await call('/me', { jwt: 'abc.def.ghi' }); if (r.status !== 401) fail(`瞎编的 JWT 回了 ${r.status}`) }
  { const r = await mcp('nope-nope-nope-nope', 'tools/list'); if (r.status !== 401) fail(`瞎编的 MCP 令牌回了 ${r.status}`) }
  ok('没身份一律 401,/health 例外')

  console.log('A 看 / B 看'); await sweepAs(A, B); await sweepAs(B, A)

  console.log('令牌换掉旧的就作废')
  { const r = await call('/settings/mcp-token/rotate', { jwt: A.jwt, method: 'POST', body: {} })
    if (r.status === 200) { const old = A.mcpToken; A.mcpToken = JSON.parse(r.text).mcpToken; const t = await mcp(old, 'tools/list'); if (t.status !== 401) fail(`旧令牌还能用:${t.status}`); else ok('旧令牌作废') }
    else fail(`换令牌:${r.status}`) }

  console.log(失败.length ? `\n✗ ${失败.length} 条没过` : '\n✓ 脑子那一层:两个人互相看不见;没身份进不来;key 不回显')
  process.exit(失败.length ? 1 : 0)
}
main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
