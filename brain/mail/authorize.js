// `npm run mail:auth` 的入口。
//
// 两件事：缺凭证就当场问你要（省得去找那个隐藏文件），然后走一次 Google
// 授权把 token 落盘。这是整条链上**唯一需要你人在场**的一步——之后
// refresh token 自己续，brain 无人值守地跑。
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { authorize, whoami, hasTokens, MailAuthError } from './auth.js'

const ENV = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')

const mask = (s) => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-6)}` : '……')

/**
 * 把一个键写进 .env：有这一行就替换，没有就补在末尾。
 * 不用正则整文件替换——.env 里别的行（service_role key 那种）碰都不该碰。
 */
function putEnv(key, value) {
  const lines = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8').split('\n') : []
  const i = lines.findIndex((l) => l.startsWith(`${key}=`))
  if (i >= 0) lines[i] = `${key}=${value}`
  else lines.push(`${key}=${value}`)
  fs.writeFileSync(ENV, lines.join('\n'), { mode: 0o600 })
}

/** 缺哪个问哪个。粘错字段是最常见的错，所以当场校验格式。 */
async function askForCreds() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log('\nbrain/.env 里还没有 Gmail 的凭证。去 Google Cloud → Clients →')
    console.log('点开你那条 client，右边有 Client ID 和 Client secret。\n')

    if (!process.env.GMAIL_CLIENT_ID) {
      const id = (await rl.question('Client ID（…apps.googleusercontent.com）：')).trim()
      if (!id) throw new MailAuthError('没给 Client ID，先算了')
      if (!id.endsWith('.apps.googleusercontent.com')) {
        console.warn('  ⚠️ 这个不像 Client ID（正常的以 .apps.googleusercontent.com 结尾）。先照你给的存着。')
      }
      putEnv('GMAIL_CLIENT_ID', id)
      process.env.GMAIL_CLIENT_ID = id
    }

    if (!process.env.GMAIL_CLIENT_SECRET) {
      const secret = (await rl.question('Client secret（GOCSPX-… ）：')).trim()
      if (!secret) throw new MailAuthError('没给 Client secret，先算了')
      if (!secret.startsWith('GOCSPX-')) {
        console.warn('  ⚠️ 这个不像 Client secret（正常的以 GOCSPX- 开头）。先照你给的存着。')
      }
      putEnv('GMAIL_CLIENT_SECRET', secret)
      process.env.GMAIL_CLIENT_SECRET = secret
    }

    console.log(`\n已经写进 brain/.env：`)
    console.log(`  GMAIL_CLIENT_ID     = ${mask(process.env.GMAIL_CLIENT_ID)}`)
    console.log(`  GMAIL_CLIENT_SECRET = ${mask(process.env.GMAIL_CLIENT_SECRET)}`)
    console.log('  （这个文件在 .gitignore 里，不会进仓库）\n')
  } finally {
    rl.close()
  }
}

try {
  if (hasTokens()) {
    try {
      const me = await whoami()
      console.log(`\n已经授权过了：${me.address}（信箱里 ${me.total} 封）`)
      console.log('要换账号或者授权掉了，先删掉 brain/.mail-tokens.json 再跑一次。\n')
      process.exit(0)
    } catch (_) {
      console.log('\n存着的凭证用不了了，重新授权一次。\n')
    }
  }

  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    if (!process.stdin.isTTY) {
      throw new MailAuthError('brain/.env 里没有 GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET，' +
        '而且这不是交互式终端，没法问你要。直接在终端里跑 `npm run mail:auth`。')
    }
    await askForCreds()
  }

  const me = await authorize()
  console.log(`\n✓ 授权好了：${me.address}（信箱里 ${me.total} 封）`)
  console.log('  凭证在 brain/.mail-tokens.json（已 gitignore，别提交）\n')
} catch (err) {
  console.error(`\n✗ ${err.message}`)
  if (err instanceof MailAuthError && err.fix) console.error(`  ${err.fix}`)
  process.exit(1)
}
