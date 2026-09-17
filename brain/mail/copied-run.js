// `npm run mail:copied`          —— 抄送栏里的人、同机构回信的人：该收的收
// `npm run mail:copied -- --dry` —— 只看它想收谁、想把谁端给你
import { copiedPass } from './copied.js'
import { makeDb as __makeDb } from '../dbauth.js'
import { initStore as __initStore } from './store.js'
__initStore((await __makeDb()).db)   // makeDb 是异步的(本机模式要开库);CLI 脚本自己接一次
const out = await copiedPass({ apply: !process.argv.includes('--dry') })
console.log('\n' + JSON.stringify(out, null, 2))
