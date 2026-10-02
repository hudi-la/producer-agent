import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tenant, currentTenant, withTenant, setStaticTenant, envFor, childEnv, settingsFromRow, rowFromSettings, modulesFor, parseBearer, jwtPayload, makeHosted } from './tenant.js'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const fakeJwt = (payload) => `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`

test('没上下文时 tenant() 回退到静态租户;withTenant 里面看到的是传进去的那个', async () => {
  setStaticTenant(null)
  assert.equal(currentTenant(), null)
  assert.throws(() => tenant(), /没有租户上下文/)
  const S = setStaticTenant({ owner: 'static' })
  assert.equal(tenant(), S)
  await withTenant({ owner: 'req-1' }, async () => {
    await new Promise((r) => setTimeout(r, 1))        // 跨过一个异步边界还在
    assert.equal(tenant().owner, 'req-1')
  })
  assert.equal(tenant().owner, 'static')
  setStaticTenant(null)
})

test('envFor:选哪条模型来源就只带哪条的凭据,不写 process.env', () => {
  const before = process.env.ANTHROPIC_API_KEY
  const s = { provider: 'claude-key', apiKey: 'sk-ant-1', oauthToken: 'sk-ant-oat', openaiKey: 'sk-o', geminiKey: 'AIza', model: 'm', modelCheap: 'c', lang: 'en' }
  assert.deepEqual(envFor(s, { dataDir: '/d/u1' }), { FAIRWIND_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'sk-ant-1', BRAIN_MODEL: 'm', BRAIN_MODEL_CHEAP: 'c', FAIRWIND_LANG: 'en', FAIRWIND_DATA_DIR: '/d/u1' })
  assert.equal(envFor({ ...s, provider: 'claude-subscription' }).CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat')
  assert.equal(envFor({ ...s, provider: 'claude-subscription' }).ANTHROPIC_API_KEY, undefined)
  assert.equal(envFor({ ...s, provider: 'openai' }).OPENAI_API_KEY, 'sk-o')
  assert.equal(envFor({ ...s, provider: 'gemini' }).FAIRWIND_PROVIDER, 'gemini')
  assert.equal(envFor({ ...s, provider: 'chatgpt-subscription' }).ANTHROPIC_API_KEY, undefined)
  assert.equal(envFor({}).FAIRWIND_LANG, 'zh')
  assert.equal(process.env.ANTHROPIC_API_KEY, before)
})

test('childEnv:进程 env 里的凭据一律去掉,再盖上租户的', () => {
  const base = { PATH: '/bin', ANTHROPIC_API_KEY: 'leak', OPENAI_API_KEY: 'leak2', FAIRWIND_LANG: 'zh' }
  const out = childEnv({ env: { FAIRWIND_PROVIDER: 'openai', OPENAI_API_KEY: 'mine', FAIRWIND_LANG: 'en' } }, base)
  assert.deepEqual(out, { PATH: '/bin', FAIRWIND_PROVIDER: 'openai', OPENAI_API_KEY: 'mine', FAIRWIND_LANG: 'en' })
})

test('库里那一行 ↔ settings 对象', () => {
  const s = settingsFromRow({ provider: 'gemini', gemini_key: 'AIza1', lang: 'en', judgments_enabled: false, modules: { pursuits: false }, mcp_token: 'tok', email: 'a@x' })
  assert.equal(s.geminiKey, 'AIza1'); assert.equal(s.lang, 'en'); assert.equal(s.judgmentsEnabled, false); assert.equal(s.mcpToken, 'tok')
  assert.deepEqual(settingsFromRow({}).provider, 'claude-key')
  assert.deepEqual(rowFromSettings({ apiKey: 'k', lang: 'en', backupDir: '/x' }), { api_key: 'k', lang: 'en' })   // 机器级的字段不进库
})

test('modulesFor:档案永远开,邮件线上第一期不开也不提供', () => {
  assert.deepEqual(modulesFor({ modules: { pursuits: false, mail: true } }), { profile: true, pursuits: false, mail: false, canToggle: true, mailOffered: false })
  assert.equal(modulesFor({}).pursuits, true)
})

test('parseBearer / jwtPayload', () => {
  assert.equal(parseBearer({ headers: { authorization: 'Bearer abc.def.g' } }), 'abc.def.g')
  assert.equal(parseBearer({ headers: { authorization: 'bearer   x ' } }), 'x')
  assert.equal(parseBearer({ headers: {} }), null)
  assert.equal(parseBearer({ headers: { authorization: 'Basic zz' } }), null)
  assert.equal(jwtPayload(fakeJwt({ sub: 'u1', exp: 9 })).sub, 'u1')
  assert.equal(jwtPayload('garbage'), null)
})

/** 假 supabase:记下每次 createClient 的参数;auth.getUser 按 JWT 里的 sub 回答;rpc 按名字回答 */
function fakeSupabase({ users = {}, secrets = {}, judgments = {}, mcp = {} } = {}) {
  const made = []
  const createClient = (url, key, opts) => {
    const jwt = /^Bearer (.+)$/.exec(opts?.global?.headers?.Authorization || '')?.[1]
    const c = {
      _opts: opts, _jwt: jwt, _session: null,
      auth: {
        getUser: async (t) => { const p = jwtPayload(t); return p && users[p.sub] ? { data: { user: { id: p.sub, email: users[p.sub] } } } : { data: { user: null }, error: { message: 'bad' } } },
        verifyOtp: async ({ token_hash }) => { c._session = token_hash; return { data: {}, error: null } },
      },
      rpc: async (name, args) => {
        const who = c._session?.replace('hash-', '') || jwtPayload(c._jwt)?.sub
        if (name === 'pa_member_secrets') return { data: [secrets[who] || {}] }
        if (name === 'pa_judgment_docs') return { data: judgments[who] || [] }
        return { error: { message: 'no such rpc ' + name } }
      },
    }
    made.push(c)
    return c
  }
  const service = {
    auth: { admin: {
      getUserById: async (id) => (users[id] ? { data: { user: { id, email: users[id] } } } : { data: {}, error: { message: 'no user' } }),
      generateLink: async ({ email }) => ({ data: { properties: { hashed_token: 'hash-' + Object.keys(users).find((k) => users[k] === email) } } }),
    } },
    rpc: async (name, { p_token }) => ({ data: mcp[p_token] || null }),
  }
  return { createClient, service, made }
}

test('hosted.fromRequest:JWT 认人、按人建客户端、设置和判据跟着人;认不出回 null', async () => {
  const f = fakeSupabase({ users: { u1: 'a@x', u2: 'b@x' }, secrets: { u1: { provider: 'openai', openai_key: 'sk-u1', lang: 'en' }, u2: { api_key: 'sk-ant-u2' } }, judgments: { u1: [{ name: '全部.md', body: '催紧点' }] } })
  const H = makeHosted({ url: 'https://p.supabase.co', anon: 'anon', service: f.service, createClient: f.createClient, dataRoot: '/var/lib/fw', docsFromRows: (rows) => ({ docs: Object.fromEntries(rows.map((r) => ['*', r.body])) }) })
  const t1 = await H.fromRequest({ headers: { authorization: 'Bearer ' + fakeJwt({ sub: 'u1', exp: 4e9 }) } })
  assert.equal(t1.owner, 'u1'); assert.equal(t1.email, 'a@x'); assert.equal(t1.mode, 'hosted')
  assert.equal(t1.env.OPENAI_API_KEY, 'sk-u1'); assert.equal(t1.env.FAIRWIND_LANG, 'en'); assert.equal(t1.env.FAIRWIND_DATA_DIR, '/var/lib/fw/users/u1')
  assert.equal(t1.db._jwt.split('.').length, 3)
  assert.deepEqual(t1.judgments, { docs: { '*': '催紧点' }, enabled: true })
  const t2 = await H.fromRequest({ headers: { authorization: 'Bearer ' + fakeJwt({ sub: 'u2', exp: 4e9 }) } })
  assert.equal(t2.env.ANTHROPIC_API_KEY, 'sk-ant-u2'); assert.equal(t2.env.OPENAI_API_KEY, undefined)
  assert.notEqual(t1.marks, t2.marks)                                    // 按人的标记各一份
  assert.equal(await H.fromRequest({ headers: {} }), null)
  assert.equal(await H.fromRequest({ headers: { authorization: 'Bearer ' + fakeJwt({ sub: 'nobody', exp: 4e9 }) } }), null)
})

test('hosted.fromRequest:同一个 JWT 第二次不再问 Auth;设置 60 秒内不重读,invalidate 后重读', async () => {
  let t = 1000
  const f = fakeSupabase({ users: { u1: 'a@x' }, secrets: { u1: { api_key: 'k1' } } })
  let asked = 0
  const createClient = (...a) => { const c = f.createClient(...a); const g = c.auth.getUser; c.auth.getUser = (x) => { asked++; return g(x) }; return c }
  const H = makeHosted({ url: 'u', anon: 'a', service: f.service, createClient, now: () => t })
  const req = { headers: { authorization: 'Bearer ' + fakeJwt({ sub: 'u1', exp: 4e9 }) } }
  await H.fromRequest(req); await H.fromRequest(req)
  assert.equal(asked, 1)
  f.createClient; // settings cached
  const secrets = f.made.filter((c) => c._jwt)
  assert.ok(secrets.length >= 2)
  // 改了 key:缓存里还是旧的,直到 invalidate
  const H2 = makeHosted({ url: 'u', anon: 'a', service: f.service, createClient: f.createClient, now: () => t, loadSettings: async () => ({ provider: 'claude-key', apiKey: 'k-' + t }) })
  const a = await H2.fromRequest(req); t += 10; const b = await H2.fromRequest(req)
  assert.equal(a.env.ANTHROPIC_API_KEY, b.env.ANTHROPIC_API_KEY)
  H2.invalidate('u1'); const c = await H2.fromRequest(req)
  assert.equal(c.env.ANTHROPIC_API_KEY, 'k-1010')
  t += 70_000; const d = await H2.fromRequest(req)
  assert.equal(d.env.ANTHROPIC_API_KEY, 'k-71010')
})

test('hosted.forOwner:用管理接口替那个人造会话,只造一次;找不到的人报错', async () => {
  const f = fakeSupabase({ users: { u1: 'a@x' }, secrets: { u1: { gemini_key: 'g', provider: 'gemini' } } })
  const H = makeHosted({ url: 'u', anon: 'a', service: f.service, createClient: f.createClient })
  const t1 = await H.forOwner('u1')
  assert.equal(t1.owner, 'u1'); assert.equal(t1.email, 'a@x'); assert.equal(t1.env.GEMINI_API_KEY, 'g')
  assert.equal(t1.db._session, 'hash-u1')
  const t2 = await H.forOwner('u1')
  assert.equal(t2.db, t1.db)                                              // 会话缓存着
  await assert.rejects(H.forOwner('ghost'), /找不到这个账号/)
  H.invalidate('u1', { session: true })
  const t3 = await H.forOwner('u1')
  assert.notEqual(t3.db, t1.db)
})

test('hosted.forMcpToken:令牌 → 人 → 会话;空的或不认识的回 null', async () => {
  const f = fakeSupabase({ users: { u1: 'a@x' }, secrets: { u1: {} }, mcp: { tok1: 'u1' } })
  const H = makeHosted({ url: 'u', anon: 'a', service: f.service, createClient: f.createClient })
  assert.equal((await H.forMcpToken('tok1')).owner, 'u1')
  assert.equal(await H.forMcpToken('nope'), null)
  assert.equal(await H.forMcpToken(''), null)
})
