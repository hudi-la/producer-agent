// brain/local/contract.test.js —— 数据库契约（2026-10-24）。
//
// 为什么要有：2026-10-23 体检查到两支迁移用旧函数体盖掉了后来加的功能——
//   0135 盖掉 0129：Fairwind 的上下文里没了「提醒栏」
//   0140 盖掉 0127：信头写库丢了署名
// 846 个单元测试全绿，因为没有一个测试碰数据库。这里把**全部迁移按顺序真跑一遍**（PGlite），
// 再对「跑完之后库里长什么样」下断言。以后谁再用旧函数体覆盖，这里当场红。
//
// 加一条约定的办法：在 CONTRACTS 里写「哪个函数的定义里必须出现什么」，或在下面加一个行为测试。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser, MIGRATIONS_DIR } from './migrate.js'

const A = 'aaaaaaaa-0000-4000-8000-0000000000c1'

// 函数名 → 它的定义里必须出现的片段（以及为什么）
const CONTRACTS = {
  pa_brain_context:        [["'state'", 'Fairwind 聊天时要看到提醒栏（0129）']],
  pa_brain_person_context: [["'state'", 'Fairwind 聊天时要看到提醒栏（0129）']],
  pa_mail_headers_upsert:  [['names', '信头要存署名，抄送的人才能自动进门（0127）']],
  pa_apply_state_move:     [['src_msg', '提醒改动要能顺着气泡撤回（0129）']],
}

async function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'fairwind-contract-'))
  const pg = await openLocalDb(dir)
  await applyMigrations(pg, { fresh: true })
  return { pg, close: async () => { await pg.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('跑完全部迁移后，关键函数的定义仍带着后来加的东西（没被旧函数体盖掉）', async () => {
  const { pg, close } = await freshDb()
  try {
    for (const [fn, musts] of Object.entries(CONTRACTS)) {
      const { rows } = await pg.query(`select pg_get_functiondef(p.oid) as d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                        where n.nspname = 'public' and p.proname = $1`, [fn])
      assert.equal(rows.length, 1, `${fn} 应该恰好有一个定义（有 ${rows.length} 个）`)
      for (const [needle, why] of musts) assert.ok(rows[0].d.includes(needle), `${fn} 里没有 ${needle}：${why}`)
    }
  } finally { await close() }
})

test('上下文函数真的回得出提醒栏：有在等的事时 state 不是空的', async () => {
  const { pg, close } = await freshDb()
  try {
    await registerLocalUser(pg, { id: A, email: 'contract@test.local' })
    await setLocalUid(pg, A)
    await assumeUser(pg)
    const { rows: [{ id }] } = await pg.query(`select (public.pa_create_pursuit('{"title":"契约测试线"}'::jsonb)->>'id')::uuid as id`)
      .catch(async () => pg.query(`insert into producer.pursuits (title) values ('契约测试线') returning id`))
    const { rows: [{ c }] } = await pg.query('select public.pa_brain_context($1) as c', [id])
    assert.ok('state' in c, '上下文里得有 state 这个键（没有在等的事时是 null）')
  } finally { await close() }
})

test('密钥原文只给服务端：浏览器会话调不到 pa_member_secrets，service_role 用 pa_member_secrets_for', async () => {
  const { pg, close } = await freshDb()
  try {
    const { rows } = await pg.query(`select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth,
                                            has_function_privilege('service_role', p.oid, 'execute') as svc
                                       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                      where n.nspname = 'public' and p.proname in ('pa_member_secrets', 'pa_member_secrets_for') order by 1`)
    assert.deepEqual(rows, [
      { proname: 'pa_member_secrets', auth: false, svc: true },
      { proname: 'pa_member_secrets_for', auth: false, svc: true },
    ])
  } finally { await close() }
})

test('迁移文件里，每个函数最后一次定义也满足契约（不用起库就能看出覆盖）', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
  for (const [fn, musts] of Object.entries(CONTRACTS)) {
    let last = null
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
      const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(public\\.)?${fn}\\s*\\(`, 'i')
      const m = sql.match(re)
      if (!m) continue
      // 函数体 = as $tag$ … $tag$ 之间
      const rest = sql.slice(m.index)
      const open = rest.match(/\bas\s+(\$[A-Za-z_]*\$)/i)
      const end = open ? rest.indexOf(open[1], open.index + open[0].length) : -1
      last = { f, body: end > 0 ? rest.slice(0, end) : rest.slice(0, 4000) }
    }
    assert.ok(last, `迁移里找不到 ${fn}`)
    for (const [needle, why] of musts) assert.ok(last.body.includes(needle), `${fn} 最后一次定义在 ${last.f}，里面没有 ${needle}：${why}`)
  }
})
