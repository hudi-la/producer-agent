// `npm run mail:sync` 的入口。
//
// 没回填过就回填，回填过就只拉增量。要强制重跑全量加 --backfill。
import { backfill, incremental } from './sync.js'
import { myAccounts } from './store.js'
import { MailAuthError } from './auth.js'

const force = process.argv.includes('--backfill')

try {
  const accounts = await myAccounts()
  const done = accounts.some((a) => a.backfilled_at)
  const t0 = Date.now()

  const out = (force || !done) ? await backfill() : await incremental()

  console.log(`\n用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(JSON.stringify(out, null, 2))
} catch (err) {
  console.error(`\n✗ ${err.message}`)
  if (err instanceof MailAuthError && err.fix) console.error(`  ${err.fix}`)
  process.exit(1)
}
