// 0165:逐封判断从「连上 Gmail 那天往前一个月」开始,按人算;没连邮箱的照旧用 p_since(2026-08-03)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './migrate.js'

const A = '0000000a-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

async function asUser(pg, uid, fn) {
  await setLocalUid(pg, uid); await assumeUser(pg)
  try { return await fn() } finally { await pg.exec('reset role') }
}

test('连上信箱前一个月以前的信不逐封判;那之后的照判;没连信箱时照旧', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fairwind-since-'))
  const pg = await openLocalDb(dir)
  try {
    await applyMigrations(pg, { fresh: true })
    await registerLocalUser(pg, { id: A, email: 'a@test.local' })
    const ids = await asUser(pg, A, async () => {
      const { rows: [{ r }] } = await pg.query(`select public.pa_create_pursuit('一条线') as r`)
      const pid = r.id
      const add = async (txt) => (await pg.query(`select public.pa_add_message($1, 'producer', $2, 'note', null) as id`, [pid, txt])).rows[0].id
      return { old: await add('两个月前记的'), recent: await add('两周前记的') }
    })
    const msgId = (x) => (typeof x === 'object' ? x.id : x)
    await pg.query(`update producer.pursuit_messages set created_at = now() - interval '60 days' where id = $1`, [msgId(ids.old)])
    await pg.query(`update producer.pursuit_messages set created_at = now() - interval '14 days' where id = $1`, [msgId(ids.recent)])
    const judged = () => asUser(pg, A, async () => (await pg.query(`select content from public.pa_facts_to_judge()`)).rows.map((r) => r.content).sort())

    // 没连信箱:照旧从 p_since(2026-08-03)判起——两条都在(测试跑在那之后)
    assert.deepEqual(await judged(), ['两个月前记的', '两周前记的'].sort())

    // 今天连上信箱:往前一个月以内的才判
    await asUser(pg, A, () => pg.query(`select public.pa_mail_account_upsert('a@gmail.com', 'Gmail')`))
    assert.deepEqual(await judged(), ['两周前记的'])
  } finally { await pg.close(); rmSync(dir, { recursive: true, force: true }) }
})
