// `npm run mail:cast`        —— 高把握的直接挂
// `npm run mail:cast -- --dry` —— 只看它想挂什么
import { castPass } from './cast.js'
const out = await castPass({ apply: !process.argv.includes('--dry') })
console.log('\n' + JSON.stringify(out, null, 2))
