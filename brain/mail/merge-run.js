// `npm run mail:merge`   —— 高把握的直接并
// `npm run mail:merge -- --dry` —— 只看它想并什么，一个都不动
import { mergePass } from './merge.js'
const out = await mergePass({ apply: !process.argv.includes('--dry') })
console.log('\n' + JSON.stringify(out, null, 2))
