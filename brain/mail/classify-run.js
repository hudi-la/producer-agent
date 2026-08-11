// `npm run mail:classify` 的入口。
// 加 --rounds N 只跑 N 批（第一次先跑一批看看它判得对不对，别一口气全跑）。
import { classify } from './classify.js'

const i = process.argv.indexOf('--rounds')
const rounds = i >= 0 ? Number(process.argv[i + 1]) : Infinity

const t0 = Date.now()
try {
  const out = await classify({ rounds })
  console.log(`\n用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(JSON.stringify(out, null, 2))
} catch (err) {
  console.error(`\n✗ ${err.message}`)
  process.exit(1)
}
