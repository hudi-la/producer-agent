// 手动认一个地址，用来验收：
//   node --env-file=.env mail/adopt-run.js <email> [--org "机构名"] [--name "人名"]
// 不给 --org 就当成人；给了就当成机构共享信箱。
import { adoptPerson, adoptOrgMailbox } from './adopt.js'
import { db } from './store.js'
import { makeDb as __makeDb } from '../dbauth.js'
import { initStore as __initStore } from './store.js'
__initStore((await __makeDb()).db)   // makeDb 是异步的(本机模式要开库);CLI 脚本自己接一次

const email = process.argv[2]
if (!email?.includes('@')) { console.error('用法：adopt-run.js <email> [--org "机构名"] [--name "人名"]'); process.exit(1) }
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null }

// 判定里已经认出来的东西直接拿来用，省得你再敲一遍
const { data: v } = await db().from('v_pa_verdict_archive').select('*').eq('email', email).limit(1)
const known = v?.[0] || {}

const org = arg('--org') ?? (known.verdict === 'shared_box' ? known.org : null)
const t0 = Date.now()
try {
  const out = org
    ? await adoptOrgMailbox(email, { org, notes: known.why })
    : await adoptPerson(email, { name: arg('--name') || known.name, org: known.org, notes: known.why })
  console.log(`\n用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(JSON.stringify(out, null, 2))
} catch (err) { console.error(`\n✗ ${err.message}`); process.exit(1) }
