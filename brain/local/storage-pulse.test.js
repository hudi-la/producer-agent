// brain/local/storage-pulse.test.js —— 0153 / 0154 的机器证明
//
// 两件事,都是「多人共用一个库」之后才会露出的洞:
//   · 附件桶的策略(0044)只认 bucket_id,anon 也放行 —— 谁都能列、能下、能删别人的文件。
//     0153 之后:只认 authenticated,而且路径第一段必须是自己的 uid。
//   · 脉搏触发器(0115)是 definer、`update … where id` 拨的是**全部**行 —— A 一动,
//     B 的页面也以为该刷新。0154 之后:只拨改动那行 owner 的那根脉搏。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './migrate.js'

const A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const B = 'bbbbbbbb-0000-4000-8000-00000000000b'
const tmp = () => mkdtempSync(join(tmpdir(), 'fairwind-storage-pulse-'))

async function freshWithTwoUsers() {
  const dir = tmp()
  const pg = await openLocalDb(dir)
  await applyMigrations(pg, { fresh: true })
  await registerLocalUser(pg, { id: A, email: 'a@test.local' })
  await registerLocalUser(pg, { id: B, email: 'b@test.local' })
  await assumeUser(pg)
  return { pg, dir }
}

/** 以某人身份读自己那根脉搏(v_pa_pulse 是 invoker 视图,RLS 之下只见自己一行) */
async function pulseOf(pg, uid) {
  await setLocalUid(pg, uid)
  const { rows } = await pg.query('select * from public.v_pa_pulse')
  return rows
}

test('0153:pursuit-files 桶上的每条策略都不给 anon,而且都按 auth.uid() 认路径', async () => {
  const dir = tmp()
  const pg = await openLocalDb(dir)
  await applyMigrations(pg, { fresh: true })
  const { rows } = await pg.query(`
    select policyname, cmd, array_to_string(roles, ',') as roles,
           coalesce(qual, '') || ' ' || coalesce(with_check, '') as body
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects'`)
  const ours = rows.filter((r) => r.body.includes('pursuit-files'))
  const cmds = new Set(ours.map((r) => r.cmd))
  for (const c of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) assert.ok(cmds.has(c), `桶上缺 ${c} 策略`)
  for (const r of ours) {
    assert.ok(!r.roles.split(',').includes('anon'), `${r.policyname} 还给 anon 开着门`)
    assert.ok(r.roles.split(',').includes('authenticated'), `${r.policyname} 没给 authenticated`)
    assert.ok(r.body.includes('auth.uid()'), `${r.policyname} 没按 auth.uid() 认路径:${r.body}`)
    assert.ok(r.body.includes('foldername'), `${r.policyname} 没看路径第一段:${r.body}`)
  }
  // 0044 的三条旧名字不能还挂在上面(不然旧策略 or 新策略 = 旧策略)
  const names = new Set(rows.map((r) => r.policyname))
  for (const n of ['pa_files_read', 'pa_files_write', 'pa_files_drop']) assert.ok(!names.has(n), `${n} 还在`)
  await pg.close(); rmSync(dir, { recursive: true, force: true })
})

test('0154:注册即有自己的一根脉搏;每人只看得见自己那根', async () => {
  const { pg, dir } = await freshWithTwoUsers()
  const a = await pulseOf(pg, A)
  const b = await pulseOf(pg, B)
  assert.equal(a.length, 1, `A 看见 ${a.length} 行脉搏`)
  assert.equal(b.length, 1, `B 看见 ${b.length} 行脉搏`)
  // 前端 maybeSingle 读的那几列都得在
  for (const col of ['n', 'board', 'thread', 'deliv', 'tasks', 'pool', 'at']) assert.ok(col in a[0], `缺列 ${col}`)
  await pg.close(); rmSync(dir, { recursive: true, force: true })
})

test('0154:A 改自己的行只拨 A 的脉搏,B 的一格不动;反过来也一样', async () => {
  const { pg, dir } = await freshWithTwoUsers()
  const a0 = (await pulseOf(pg, A))[0]
  const b0 = (await pulseOf(pg, B))[0]

  await setLocalUid(pg, A)
  await pg.query(`insert into producer.works (title) values ('A 的一条')`)
  const a1 = (await pulseOf(pg, A))[0]
  const b1 = (await pulseOf(pg, B))[0]
  assert.equal(a1.n, a0.n + 1, 'A 的 n 没动')
  assert.equal(b1.n, b0.n, 'B 的 n 被 A 的改动拨了')

  await setLocalUid(pg, B)
  await pg.query(`insert into producer.works (title) values ('B 的一条')`)
  await pg.query(`update producer.works set title = 'B 改过' where title = 'B 的一条'`)
  const a2 = (await pulseOf(pg, A))[0]
  const b2 = (await pulseOf(pg, B))[0]
  assert.equal(b2.n, b1.n + 2, 'B 的 n 没动够两格(insert + update)')
  assert.equal(a2.n, a1.n, 'A 的 n 被 B 的改动拨了')

  // 0112 的规矩不变:改了 0 行不算动过
  await pg.query(`update producer.works set title = 'x' where false`)
  assert.equal((await pulseOf(pg, B))[0].n, b2.n, '0 行的 update 拨了脉搏')
  await pg.close(); rmSync(dir, { recursive: true, force: true })
})

test('0154:无主的改动(迁移 / service 老路,uid 为 null)不报错、不拨任何人', async () => {
  const { pg, dir } = await freshWithTwoUsers()
  const a0 = (await pulseOf(pg, A))[0]
  await setLocalUid(pg, '')
  await pg.exec('reset role')
  await pg.query(`insert into producer.works (title) values ('无主')`)
  await pg.query(`truncate producer.address_verdicts`)   // truncate 那条拿不到过渡表,走另一支
  await pg.exec('set role authenticated')
  assert.equal((await pulseOf(pg, A))[0].n, a0.n, '无主改动拨了 A 的脉搏')
  await pg.close(); rmSync(dir, { recursive: true, force: true })
})
