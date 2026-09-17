// `npm run mail:refetch <message id> [id...]` 的入口。
import { refetch, settle } from './refetch.js'
import { MailAuthError } from './auth.js'
import { makeDb as __makeDb } from '../dbauth.js'
import { initStore as __initStore } from './store.js'
__initStore((await __makeDb()).db)   // makeDb 是异步的(本机模式要开库);CLI 脚本自己接一次

const ids = process.argv.slice(2).filter(Boolean)
if (!ids.length) {
  console.error('用法：npm run mail:refetch -- <gmail message id> [id...]')
  process.exit(1)
}

try {
  const { rows } = await refetch(ids)
  if (rows.length) await settle(rows)
} catch (err) {
  console.error(`\n✗ ${err.message}`)
  if (err instanceof MailAuthError && err.fix) console.error(`  ${err.fix}`)
  process.exit(1)
}
