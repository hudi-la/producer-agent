// `npm run mail:merge`   —— 高把握的直接并
// `npm run mail:merge -- --dry` —— 只看它想并什么，一个都不动
import { mergePass } from './merge.js'
import { makeDb as __makeDb } from '../dbauth.js'
import { initStore as __initStore } from './store.js'
__initStore((await __makeDb()).db)   // makeDb 是异步的(本机模式要开库);CLI 脚本自己接一次
const out = await mergePass({ apply: !process.argv.includes('--dry') })
console.log('\n' + JSON.stringify(out, null, 2))
