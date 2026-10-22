// brain/local/tenant-tables.test.js —— 0150 member_settings / 0151 judgment_docs 在 PGlite 上的隔离与遮罩。
//
// 两个人 A、B 各注册一次;以 A 的身份存 key,再以 B 的身份读——B 看不见 A 的任何一个字节。
// pa_member_settings 只回显末 6 位;pa_member_secrets 才给全串(脑子替这个人调模型要用)。
// 末尾还有一条机器判:这两支新加的 pa_* 全是 invoker、anon 一个都调不了(设计稿 D11)。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './migrate.js'

const A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const B = 'bbbbbbbb-0000-4000-8000-00000000000b'
const A_KEY = 'sk-ant-abcdef123456'
const tmp = () => mkdtempSync(join(tmpdir(), 'fairwind-tenant-'))

async function freshWithTwoUsers() {
  const dir = tmp()
  const pg = await openLocalDb(dir)
  await applyMigrations(pg, { fresh: true })
  await registerLocalUser(pg, { id: A, email: 'a@test.local' })
  await registerLocalUser(pg, { id: B, email: 'b@test.local' })
  await assumeUser(pg)
  const as = (uid) => setLocalUid(pg, uid)
  const one = async (sql, params) => (await pg.query(sql, params)).rows[0]
  return { pg, dir, as, one, close: async () => { await pg.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('member_settings:注册即有一行;pa_member_settings 遮 key、pa_member_secrets 给全串;B 看不见 A 的', async () => {
  const db = await freshWithTwoUsers()
  try {
    await db.as(A)
    // 注册触发器建的默认行:出厂值、mcp_token 已生成
    const seeded = (await db.one('select pa_member_settings() as s')).s
    assert.ok(seeded, '注册后应有一行')
    assert.equal(seeded.provider, 'claude-key')
    assert.equal(seeded.lang, 'en')   // 0160:托管版新账号默认英文
    assert.equal(seeded.judgments_enabled, true)
    assert.deepEqual(seeded.modules, { profile: true, pursuits: true, mail: false })
    assert.equal(seeded.api_key_set, false)
    assert.equal(seeded.api_key_hint, '')
    assert.match(seeded.mcp_token, /^[0-9a-f]{48}$/)
    assert.ok(!('api_key' in seeded), '遮罩版不带 api_key 字段')

    // 存 key:只回显末 6 位,全串不出现
    const masked = (await db.one('select pa_set_member_settings($1::jsonb) as s', [JSON.stringify({ api_key: A_KEY })])).s
    assert.equal(masked.api_key_set, true)
    assert.equal(masked.api_key_hint, '123456')
    assert.ok(!JSON.stringify(masked).includes(A_KEY), '遮罩版不许带全串')
    const again = (await db.one('select pa_member_settings() as s')).s
    assert.equal(again.api_key_hint, '123456')
    assert.ok(!JSON.stringify(again).includes(A_KEY))
    // 只改传了的字段:provider 没传,还是出厂值
    assert.equal(again.provider, 'claude-key')

    // 全串只在 pa_member_secrets
    const secrets = (await db.one('select pa_member_secrets() as s')).s
    assert.equal(secrets.api_key, A_KEY)
    assert.equal(secrets.mcp_token, seeded.mcp_token)

    // 部分更新 + 空串清掉
    const upd = (await db.one('select pa_set_member_settings($1::jsonb) as s',
      [JSON.stringify({ provider: 'openai', openai_key: 'sk-openai-zzzzzz', model: 'gpt-5', api_key: '' })])).s
    assert.equal(upd.provider, 'openai')
    assert.equal(upd.openai_key_set, true); assert.equal(upd.openai_key_hint, 'zzzzzz')
    assert.equal(upd.model, 'gpt-5')
    assert.equal(upd.api_key_set, false); assert.equal(upd.api_key_hint, '')
    assert.equal((await db.one('select pa_member_secrets() as s')).s.api_key, null)
    // mcp_token 不能从 p 里改
    const sneaky = (await db.one('select pa_set_member_settings($1::jsonb) as s', [JSON.stringify({ mcp_token: 'hijack' })])).s
    assert.equal(sneaky.mcp_token, seeded.mcp_token)

    // B:自己的行,干干净净;A 的 key 一个字节都没有
    await db.as(B)
    const bs = (await db.one('select pa_member_settings() as s')).s
    assert.ok(bs); assert.equal(bs.api_key_set, false); assert.equal(bs.openai_key_set, false)
    assert.notEqual(bs.mcp_token, seeded.mcp_token)
    const bsec = (await db.one('select pa_member_secrets() as s')).s
    assert.ok(!JSON.stringify(bsec).includes(A_KEY)); assert.ok(!JSON.stringify(bsec).includes('zzzzzz'))
    assert.equal(bsec.api_key, null)
    // 直读表也只有自己一行
    const raw = await db.pg.query('select owner from producer.member_settings')
    assert.deepEqual(raw.rows.map((r) => r.owner), [B])

    // 换令牌:变了,而且 A 的没动
    const rotated = (await db.one('select pa_rotate_mcp_token() as t')).t
    assert.match(rotated, /^[0-9a-f]{48}$/)
    assert.notEqual(rotated, bs.mcp_token)
    assert.equal((await db.one('select pa_member_settings() as s')).s.mcp_token, rotated)
    await db.as(A)
    assert.equal((await db.one('select pa_member_settings() as s')).s.mcp_token, seeded.mcp_token)
  } finally { await db.close() }
})

test('judgment_docs:A 存两篇,B 一篇都看不见;A 删一篇剩一篇', async () => {
  const db = await freshWithTwoUsers()
  try {
    await db.as(A)
    await db.pg.query("select pa_set_judgment_doc('reply', '# 要不要回\\n先看对方问了没有')")
    await db.pg.query("select pa_set_judgment_doc('wait', '等多久')")
    let docs = (await db.pg.query('select * from pa_judgment_docs()')).rows
    assert.deepEqual(docs.map((d) => d.name), ['reply', 'wait'])
    assert.ok(docs[0].body.startsWith('# 要不要回')); assert.ok(docs[0].updated_at)
    // 同名覆盖,不是第二篇
    await db.pg.query("select pa_set_judgment_doc('wait', '等三天')")
    docs = (await db.pg.query('select * from pa_judgment_docs()')).rows
    assert.equal(docs.length, 2); assert.equal(docs[1].body, '等三天')

    await db.as(B)
    assert.deepEqual((await db.pg.query('select * from pa_judgment_docs()')).rows, [])
    assert.deepEqual((await db.pg.query('select * from producer.judgment_docs')).rows, [])
    // B 删 A 的:无事发生
    await db.pg.query("select pa_drop_judgment_doc('reply')")

    await db.as(A)
    assert.equal((await db.pg.query('select * from pa_judgment_docs()')).rows.length, 2)
    await db.pg.query("select pa_drop_judgment_doc('reply')")
    docs = (await db.pg.query('select * from pa_judgment_docs()')).rows
    assert.deepEqual(docs.map((d) => d.name), ['wait'])
    // 空名字不收
    await assert.rejects(db.pg.query("select pa_set_judgment_doc('  ', 'x')"))
  } finally { await db.close() }
})

test('0150 / 0151 新加的 pa_*:全是 invoker,anon 一个都调不了;两张表 RLS 开着、policy 在', async () => {
  const db = await freshWithTwoUsers()
  try {
    const names = ['pa_member_settings', 'pa_set_member_settings', 'pa_rotate_mcp_token', 'pa_member_secrets',
      'pa_judgment_docs', 'pa_set_judgment_doc', 'pa_drop_judgment_doc']
    const { rows } = await db.pg.query(`
      select p.proname as name, p.prosecdef as definer,
             has_function_privilege('anon', p.oid, 'execute') as anon_can,
             has_function_privilege('authenticated', p.oid, 'execute') as auth_can,
             has_function_privilege('service_role', p.oid, 'execute') as service_can
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1::text[]) order by 1`, [names])
    assert.deepEqual(rows.map((r) => r.name).sort(), [...names].sort(), '每个函数都得在')
    for (const r of rows) {
      assert.equal(r.definer, false, `${r.name} 不得是 security definer(0137 之后的规矩)`)
      assert.equal(r.anon_can, false, `${r.name} 不得授给 anon`)
      assert.equal(r.auth_can, true, `${r.name} 要授给 authenticated`)
      assert.equal(r.service_can, true, `${r.name} 要授给 service_role`)
    }
    const t = await db.pg.query(`
      select c.relname, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies pp where pp.schemaname = 'producer' and pp.tablename = c.relname and pp.policyname = 'own_rows') as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'producer' and c.relname in ('member_settings', 'judgment_docs') order by 1`)
    assert.deepEqual(t.rows, [
      { relname: 'judgment_docs', rls: true, policies: 1 },
      { relname: 'member_settings', rls: true, policies: 1 },
    ])
  } finally { await db.close() }
})
