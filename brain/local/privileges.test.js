// brain/local/privileges.test.js —— 目录级的权限判:谁能调哪个 pa_*、以谁的身份跑。
//
// 设计稿 docs/specs/2026-10-02-hosted-fairwind-design.md 的 D4 / D11:
//   · 0137 之后任何 pa_* 都不许是 security definer(写了就等于给所有人开一道绕过 RLS 的后门),
//     唯一的例外是脑子「找活」的两个只读口 pa_tasks_due_all / pa_briefs_due_all——
//     它们必须跨所有人查,所以是 definer,但只授 service_role。
//   · anon(没登录)对任何 pa_* 都没有 execute。
// 这些规则不靠人记,靠这个测试按 pg_proc 扫。以后谁再写回 definer 或授给 anon,这里当场红。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './migrate.js'

const A = '0000000a-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = '0000000b-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// 允许 definer 的名单。加名字要有理由写在这里,而且下面会顺带验它只授 service_role:
//   pa_tasks_due_all        脑子跨所有人找到点的任务(0155;只读,只授 service_role)
//   pa_briefs_due_all       脑子跨所有人找要读的新机会(0155;只读,只授 service_role)
//   pa_owner_of_mcp_token   查 MCP 令牌是谁的——查的时候还没有身份(0156;只读,只授 service_role)
//   pa_mail_due_all         脑子跨所有人找连了 Gmail 的人去收信(0162;只读,只授 service_role)
//   pa_member_secrets_for   脑子替某个人读他的密钥(0169;只读,只授 service_role——浏览器会话从此拿不到密钥原文)
const DEFINER_ALLOWLIST = new Set(['pa_tasks_due_all', 'pa_briefs_due_all', 'pa_owner_of_mcp_token', 'pa_mail_due_all', 'pa_member_secrets_for'])

const PA_FUNCTIONS = `
  select p.proname as name, p.oid::regprocedure::text as sig, p.prosecdef as definer,
         has_function_privilege('anon', p.oid, 'execute') as anon_can,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_can,
         has_function_privilege('service_role', p.oid, 'execute') as service_can
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'pa\\_%'
   order by 1`

async function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'fairwind-priv-'))
  const pg = await openLocalDb(dir)
  await applyMigrations(pg, { fresh: true })
  const close = async () => { await pg.close(); rmSync(dir, { recursive: true, force: true }) }
  return { pg, close }
}

/** 以某个本机用户的身份跑一段:切成 authenticated + 设 uid;跑完回超级用户 */
async function asUser(pg, uid, fn) {
  await setLocalUid(pg, uid)
  await assumeUser(pg)
  try { return await fn() } finally { await pg.exec('reset role') }
}

test('目录:public.pa_* 全是 invoker(白名单的两个找活口除外),anon 一个都调不了', async () => {
  const { pg, close } = await freshDb()
  try {
    const { rows } = await pg.query(PA_FUNCTIONS)
    assert.ok(rows.length > 80, `只扫到 ${rows.length} 个 pa_*,怀疑没跑全迁移`)

    const definers = rows.filter((r) => r.definer && !DEFINER_ALLOWLIST.has(r.name)).map((r) => r.sig)
    assert.deepEqual(definers, [], `这些 pa_* 还是 security definer(0137 之后不许):${definers.join(', ')}`)

    const anonCan = rows.filter((r) => r.anon_can).map((r) => r.sig)
    assert.deepEqual(anonCan, [], `anon 还能调这些 pa_*:${anonCan.join(', ')}`)

    // 白名单里的两个真的在,而且真的是 definer——不然白名单是摆设
    for (const name of DEFINER_ALLOWLIST) {
      const r = rows.find((x) => x.name === name)
      assert.ok(r, `${name} 不在目录里`)
      assert.equal(r.definer, true, `${name} 应当是 security definer`)
    }
  } finally { await close() }
})

test('目录:找活的两个口只给 service_role;普通的 pa_* 给 authenticated + service_role', async () => {
  const { pg, close } = await freshDb()
  try {
    const { rows } = await pg.query(PA_FUNCTIONS)
    const by = Object.fromEntries(rows.map((r) => [r.name, r]))
    for (const name of DEFINER_ALLOWLIST) {
      assert.equal(by[name].auth_can, false, `${name} 不该授给 authenticated`)
      assert.equal(by[name].service_can, true, `${name} 该授给 service_role`)
    }
    for (const name of ['pa_set_entry_box', 'pa_set_entry_box_json', 'pa_restart_studio', 'pa_rewind_studio', 'pa_link_thread']) {
      assert.ok(by[name], `${name} 不在目录里`)
      assert.equal(by[name].definer, false, `${name} 还是 definer`)
      assert.equal(by[name].auth_can, true, `${name} 该授给 authenticated`)
      assert.equal(by[name].service_can, true, `${name} 该授给 service_role`)
    }
  } finally { await close() }
})

test('行为:B 拿着 A 的条目 id 调 pa_set_entry_box,A 的盒子一个字都不会变', async () => {
  const { pg, close } = await freshDb()
  try {
    await registerLocalUser(pg, { id: A, email: 'a@test.local' })
    await registerLocalUser(pg, { id: B, email: 'b@test.local' })

    const entryId = await asUser(pg, A, async () => {
      const { rows } = await pg.query(`select public.pa_add_entry('work', 'A 的作品') as id`)
      await pg.query(`select public.pa_set_entry_box($1, '为什么是现在', 'A 写的')`, [rows[0].id])
      const { rows: [w] } = await pg.query(`select box from producer.works where id = $1`, [rows[0].id])
      assert.equal(w.box['为什么是现在'], 'A 写的')
      return rows[0].id
    })

    await asUser(pg, B, async () => {
      // invoker + RLS:B 看不见这一行,update 命中 0 行 → 函数报「库里没有这条」。
      // 报错或静默都算过;不许的是改到。
      await assert.rejects(pg.query(`select public.pa_set_entry_box($1, '为什么是现在', 'B 改的')`, [entryId]))
      await assert.rejects(pg.query(`select public.pa_set_entry_box_json($1, '材料', '["b"]'::jsonb)`, [entryId]))
      const { rows } = await pg.query(`select id from producer.works where id = $1`, [entryId])
      assert.equal(rows.length, 0, 'B 不该看得见 A 的条目')
    })

    const { rows: [after] } = await pg.query(`select box, owner from producer.works where id = $1`, [entryId])
    assert.equal(after.owner, A)
    assert.deepEqual(after.box, { '为什么是现在': 'A 写的' })
  } finally { await close() }
})

test('找活:pa_tasks_due_all 以超级用户调拿到两个人的到点任务;以 authenticated 调是权限错', async () => {
  const { pg, close } = await freshDb()
  try {
    await registerLocalUser(pg, { id: A, email: 'a@test.local' })
    await registerLocalUser(pg, { id: B, email: 'b@test.local' })
    // 各自把出厂的 scout 任务拨到「已经到点」——RLS 之下这条 update 只碰得到自己那条
    for (const uid of [A, B]) {
      await asUser(pg, uid, async () => {
        const { rows } = await pg.query(
          `update producer.tasks set enabled = true, next_run_at = now() - interval '1 hour', running_since = null
            where type = 'scout_aggregators' returning owner`)
        assert.deepEqual(rows.map((r) => r.owner), [uid])
      })
    }
    // 对照:单人口 pa_tasks_due 在 A 的身份下只见 A 的
    await asUser(pg, A, async () => {
      const { rows: [{ due }] } = await pg.query(`select public.pa_tasks_due() as due`)
      assert.equal(due.length, 1)
    })

    const { rows } = await pg.query(`select owner, id, task from public.pa_tasks_due_all()`)
    assert.deepEqual(rows.map((r) => r.owner).sort(), [A, B].sort())
    for (const r of rows) {
      assert.equal(r.task.id, r.id)
      assert.equal(r.task.type, 'scout_aggregators')
      assert.ok(r.task.prompt, 'task 里带着整行(prompt 等),跟 pa_tasks_due 的元素同形')
    }

    await asUser(pg, A, async () => {
      await assert.rejects(pg.query(`select * from public.pa_tasks_due_all()`), /permission denied/i)
    })
  } finally { await close() }
})

test('找活:pa_briefs_due_all 跨所有人返回待读的新机会;以 authenticated 调是权限错', async () => {
  const { pg, close } = await freshDb()
  try {
    await registerLocalUser(pg, { id: A, email: 'a@test.local' })
    await registerLocalUser(pg, { id: B, email: 'b@test.local' })
    for (const [uid, mark] of [[A, 'A 的机会'], [B, 'B 的机会']]) {
      await asUser(pg, uid, async () => {
        await pg.query(`insert into producer.pursuits (title, stage) values ($1, 'pending'), ($1 || '(已读)', 'brief')`, [mark])
      })
    }
    const { rows } = await pg.query(`select owner, id, title from public.pa_briefs_due_all()`)
    assert.deepEqual(rows.map((r) => [r.owner, r.title]).sort(), [[A, 'A 的机会'], [B, 'B 的机会']].sort())

    await asUser(pg, B, async () => {
      await assert.rejects(pg.query(`select * from public.pa_briefs_due_all()`), /permission denied/i)
    })
  } finally { await close() }
})

test('Gmail:各连各的;pa_set_gmail 只动自己那一行,pa_mail_due_all 只列连上且开着的', async () => {
  const { pg, close } = await freshDb()
  try {
    await registerLocalUser(pg, { id: A, email: 'a@test.local' })
    await registerLocalUser(pg, { id: B, email: 'b@test.local' })
    const pub = await asUser(pg, A, async () => {
      const { rows: [r] } = await pg.query(`select public.pa_set_gmail(' A@Gmail.com ', 'rt-a') as s`)
      return r.s
    })
    assert.equal(pub.gmail_address, 'a@gmail.com')
    assert.equal(pub.gmail_connected, true)
    assert.equal(pub.modules.mail, true)
    assert.ok(!('gmail_refresh_token' in pub), '页面那支不许带钥匙')

    // 0169:钥匙只在服务端读(pa_member_secrets_for),浏览器会话连自己的原文也拿不到了
    {
      const { rows: [{ s }] } = await pg.query(`select public.pa_member_secrets_for($1) as s`, [A])
      assert.equal(s.gmail_refresh_token, 'rt-a')
      const { rows: [{ s: sb }] } = await pg.query(`select public.pa_member_secrets_for($1) as s`, [B])
      assert.equal(sb?.gmail_refresh_token ?? null, null, 'B 那一行没有 A 的钥匙')
    }
    await asUser(pg, A, async () => {
      await assert.rejects(pg.query(`select public.pa_member_secrets() as s`), /permission denied/)
    })
    await asUser(pg, B, async () => {
      await assert.rejects(pg.query(`select public.pa_set_gmail('b@gmail.com', null)`), /要么都给/)
    })

    let { rows } = await pg.query(`select owner from public.pa_mail_due_all()`)
    assert.deepEqual(rows.map((r) => r.owner), [A])

    await asUser(pg, A, () => pg.query(`select public.pa_set_gmail(null, null)`))
    ;({ rows } = await pg.query(`select owner from public.pa_mail_due_all()`))
    assert.deepEqual(rows, [])
    const { rows: [after] } = await pg.query(`select gmail_address, gmail_refresh_token, modules from producer.member_settings where owner = $1`, [A])
    assert.equal(after.gmail_refresh_token, null)
    assert.equal(after.modules.mail, false)

    await asUser(pg, A, async () => { await assert.rejects(pg.query(`select * from public.pa_mail_due_all()`)) })
  } finally { await close() }
})
