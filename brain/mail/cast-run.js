// `npm run mail:cast`        —— 高把握的直接挂
// `npm run mail:cast -- --dry` —— 只看它想挂什么
import { castPass } from './cast.js'
import { makeDb as __makeDb } from '../dbauth.js'
import { initStore as __initStore } from './store.js'
__initStore((await __makeDb()).db)   // makeDb 是异步的(本机模式要开库);CLI 脚本自己接一次
const out = await castPass({ apply: !process.argv.includes('--dry') })
console.log('\n' + JSON.stringify(out, null, 2))
