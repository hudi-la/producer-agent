// 学员路的登录:问一次邮箱密码,会话落盘,以后 brain 自动续期。
//   npm run db:login
// 密码在终端里是明文输入——第一版认了;③ 一键安装会把这步挪进页面。
import { createInterface } from 'node:readline/promises'
import { makeDb, requireUser } from './dbauth.js'

const { db, mode } = makeDb()
if (mode === 'service') {
  console.log('这台配的是 SERVICE_ROLE(个人版老路),不需要登录。')
  process.exit(0)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const email = (await rl.question('邮箱:')).trim()
const password = await rl.question('密码:')
rl.close()

const { error } = await db.auth.signInWithPassword({ email, password })
if (error) {
  console.error('✗ 登录失败:' + error.message)
  process.exit(1)
}
const user = await requireUser(db)
console.log(`✓ 已登录:${user.email}。会话存好了,brain 会自动续期。`)
process.exit(0)
