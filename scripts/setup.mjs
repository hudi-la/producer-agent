// Fairwind 装机:一次问答,写好全部配置。
//
//   npm run setup           交互式
//   npm run setup -- --dry  只打印会写什么,不动任何文件
//
// 学员的完整旅程(课前装机那半小时):
//   1. 装 Node ≥ 20,克隆/解压这个包
//   2. npm run setup     ← 本脚本:装依赖、问 API key、写配置、注册账号
//   3. npm run fairwind  ← 起 brain + 页面,浏览器自动开
//   4. 页面上登录 → 「我的档案」把自己填进去 → 连 Gmail
//
// 原则:**能不问就不问**(库地址、anon key、Gmail 应用都在 setup/defaults.mjs
// 里出厂),问的只有属于学员自己的东西(API key、账号)。已存在的配置文件
// 绝不静默覆盖。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import defaults from '../setup/defaults.mjs'

const DRY = process.argv.includes('--dry')
const say = (s) => console.log(s)

function write(file, content) {
  if (DRY) { say(`\n── ${file}(dry,不写)──\n${content}`); return }
  writeFileSync(file, content)
  say(`  ✓ 写好 ${file}`)
}

async function main() {
  say('\nFairwind 装机\n')

  // ── 0. Node 版本(--env-file 要 20.6+)─────────────────
  const [maj, min] = process.versions.node.split('.').map(Number)
  if (maj < 20 || (maj === 20 && min < 6)) {
    say(`✗ Node ${process.versions.node} 太老,要 20.6 以上。装新版再来:https://nodejs.org`)
    process.exit(1)
  }

  // ── 1. 依赖 ────────────────────────────────────────────
  for (const [dir, mark] of [['.', 'node_modules'], ['brain', 'brain/node_modules']]) {
    if (!existsSync(mark)) {
      say(`· 装依赖(${dir === '.' ? '前端' : 'brain'})…`)
      if (!DRY) execSync('npm install --silent', { cwd: dir, stdio: 'inherit' })
    }
  }

  // ── 2. 问属于学员自己的东西 ─────────────────────────────
  // 不用 rl.question:stdin 是管道时它会在 EOF 后静默挂起,流程断在中间
  // 还 exit 0——比报错更坏。这里自己排队:行来了就收着,EOF 后一律给空串。
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const 行队列 = []; const 等着的 = []; let 关了 = false
  rl.on('line', (l) => { const w = 等着的.shift(); w ? w(l) : 行队列.push(l) })
  rl.on('close', () => { 关了 = true; while (等着的.length) 等着的.shift()('') })
  const readLine = () => 行队列.length ? Promise.resolve(行队列.shift())
    : 关了 ? Promise.resolve('') : new Promise((r) => 等着的.push(r))
  const ask = async (q, def) => {
    process.stdout.write(def ? `${q}(回车 = ${def}):` : `${q}:`)
    const a = (await readLine()).trim()
    return a || def || ''
  }

  say('模型的钱走你自己的 key。去 console.anthropic.com 建一个(sk-ant- 开头)。')
  const apiKey = await ask('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY)
  if (!apiKey) say('  · 没填。那 brain 会走这台机器上 Claude Code 的订阅登录态(没有的话跑不了)。')
  const good = await ask('好档模型', defaults.BRAIN_MODEL)
  const cheap = await ask('便宜档模型', defaults.BRAIN_MODEL_CHEAP)

  // ── 3. 写前端配置 ──────────────────────────────────────
  const envLocal = [
    '# Fairwind 前端配置(npm run setup 生成)',
    `VITE_SUPABASE_URL=${defaults.SUPABASE_URL}`,
    `VITE_SUPABASE_ANON_KEY=${defaults.SUPABASE_ANON_KEY}`,
    '',
  ].join('\n')
  if (existsSync('.env.local') && (await ask('.env.local 已存在,覆盖?(y/N)', 'n')).toLowerCase() !== 'y') {
    say('  · 留着原来的 .env.local')
  } else write('.env.local', envLocal)

  // ── 4. 写 brain 配置 ───────────────────────────────────
  const gmailReady = defaults.GMAIL_CLIENT_ID && defaults.GMAIL_CLIENT_SECRET
  const brainEnv = [
    '# Fairwind brain 配置(npm run setup 生成)',
    `SUPABASE_URL=${defaults.SUPABASE_URL}`,
    `SUPABASE_ANON_KEY=${defaults.SUPABASE_ANON_KEY}`,
    '# 学员路:登录会话被行级权限管着,这台机器上没有能读别人数据的钥匙',
    apiKey ? `ANTHROPIC_API_KEY=${apiKey}` : '#ANTHROPIC_API_KEY=',
    `BRAIN_MODEL=${good}`,
    `BRAIN_MODEL_CHEAP=${cheap}`,
    gmailReady ? `GMAIL_CLIENT_ID=${defaults.GMAIL_CLIENT_ID}` : '# Gmail 共用应用还没配好(setup/defaults.mjs),先跳过',
    gmailReady ? `GMAIL_CLIENT_SECRET=${defaults.GMAIL_CLIENT_SECRET}` : '#GMAIL_CLIENT_ID=  #GMAIL_CLIENT_SECRET=',
    '',
  ].join('\n')
  if (existsSync('brain/.env') && (await ask('brain/.env 已存在,覆盖?(y/N)', 'n')).toLowerCase() !== 'y') {
    say('  · 留着原来的 brain/.env')
  } else write('brain/.env', brainEnv)

  // ── 5. 账号 ───────────────────────────────────────────
  say('\n建账号(brain 也用它连库)。已有账号就直接输同一套。')
  const email = await ask('邮箱')
  if (email && !DRY) {
    const password = await ask('密码(至少 8 位)')
    const { createClient } = await import('@supabase/supabase-js')
    const supa = createClient(defaults.SUPABASE_URL, defaults.SUPABASE_ANON_KEY)
    let { data, error } = await supa.auth.signUp({ email, password })
    if (error && /already registered/i.test(error.message)) {
      ;({ data, error } = await supa.auth.signInWithPassword({ email, password }))
    }
    if (error) say(`  ✗ ${error.message}——待会在页面上再试也一样`)
    else if (!data.session) say('  · 注册好了,但要先去邮箱点确认信,然后在 brain/ 里跑 npm run db:login')
    else {
      // 会话直接交给 brain 的会话文件,省掉再跑一次 db:login
      writeFileSync('brain/.supabase-session.json',
        JSON.stringify({ fairwind: JSON.stringify(data.session) }))
      say(`  ✓ 已登录 ${email},brain 的会话也存好了`)
    }
  }
  rl.close()

  say(`\n下一步:npm run fairwind(起 brain + 页面,浏览器自动开)`)
  say(gmailReady ? '页面上还要连一次 Gmail。' : '⚠️ Gmail 那步现在还做不了(共用应用未配),先用别的功能。')
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
