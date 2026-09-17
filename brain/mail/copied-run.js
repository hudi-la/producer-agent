// `npm run mail:copied`          —— 抄送栏里的人、同机构回信的人：该收的收
// `npm run mail:copied -- --dry` —— 只看它想收谁、想把谁端给你
import { copiedPass } from './copied.js'
const out = await copiedPass({ apply: !process.argv.includes('--dry') })
console.log('\n' + JSON.stringify(out, null, 2))
