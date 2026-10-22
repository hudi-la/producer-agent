// 线上测试账号的一次性登录链接(2026-10-07)。
//
//   node scripts/test-user-link.mjs                      默认 fairwind-test@hudiworks.com
//   node scripts/test-user-link.mjs --email=别的@地址
//   node scripts/test-user-link.mjs --reset              先把这个测试账号连同它名下所有东西删掉,再建一个新的(从头再走一遍)
//
// 线上只开了 Google 登录;测试账号没有 Google,所以用 Supabase 的管理接口直接造一个账号、
// 生成一条免密码登录链接(不发邮件)。链接一小时内有效、只能用一次——在无痕窗口打开,就是以测试账号登录。
// 只给测试账号用:脚本拒绝对不像测试地址的邮箱 --reset。
//
// ⚠️ 一个账号同一时间只有**最新**那条链接有效。脑子替人在后台干活时(tenant.js forOwner)也是造这种链接换会话的——
//    脑子一重启(发新版),几秒内就会替测试账号再造一条,把你刚给出去的挤掉(10/7 撞过)。所以:发完新版等半分钟再生成。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(readFileSync(`${homedir()}/.fairwind-hosted.env`, 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]))
const EMAIL = (process.argv.find((a) => a.startsWith('--email=')) || '--email=fairwind-test@hudiworks.com').split('=')[1].toLowerCase()
const RESET = process.argv.includes('--reset')
const ORIGIN = env.BRAIN_ORIGIN || 'https://fairwind.hudiworks.com'
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).auth.admin

async function find() {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const u = data.users.find((x) => (x.email || '').toLowerCase() === EMAIL)
    if (u || data.users.length < 200) return u || null
  }
  return null
}

let u = await find()
if (u && RESET) {
  if (!/test/.test(EMAIL)) throw new Error('只许 --reset 测试账号(地址里要有 test)')
  const { error } = await admin.deleteUser(u.id)      // owner 外键 on delete cascade:它名下的行一起走
  if (error) throw error
  console.log(`删掉了旧的测试账号 ${EMAIL}`)
  u = null
}
if (!u) {
  const { data, error } = await admin.createUser({ email: EMAIL, email_confirm: true, user_metadata: { full_name: 'Fairwind Test' } })
  if (error) throw error
  u = data.user
  console.log(`建了测试账号 ${EMAIL}(${u.id})`)
} else console.log(`测试账号已经有了:${EMAIL}(${u.id})`)

const { data: link, error } = await admin.generateLink({ type: 'magiclink', email: EMAIL, options: { redirectTo: ORIGIN } })
if (error) throw error
// 不给 Supabase 那条 verify 链接:聊天窗口 / 浏览器预览会先访问一次,一次性的就作废了。
// 给 Fairwind 自己的登录页 + token_hash,页面上要人按「以测试账号登录」才真的换(Login.jsx)
console.log('\n登录链接(一小时内有效,用无痕窗口打开,再按「以测试账号登录」):\n')
console.log(`${ORIGIN}/?token_hash=${link.properties.hashed_token}&type=magiclink`)
