// 隔离测试:「数据不会泄露」的机器证明。
//
// 权限规则出错是静默的——不报错,只是多返回几行。人工看不出来,只有
// 机器能。这个脚本证明的性质:
//
//   两个用户各写一整套数据(标记串藏在标题/邮箱/正文里),然后以 A 的
//   身份把**每张表、每个视图**全部读一遍、把关键函数全部调一遍,断言
//   B 的标记串一个字节都不出现。反向再来一遍。最后验证 anon(没登录)
//   什么都摸不到。
//
// 两个设计点:
// · 扫描是**按目录来的**(pg_class 里现查),不是手写清单——以后新加
//   一张表忘了配权限,这里会当场红,不会静默漏网。
// · 每个用户先断言**看得见自己的数据**。不然「全都查不到」也能绿——
//   空空如也的绿不算证明。
//
// 跑法:node scripts/isolation-test.mjs   (连 .env 里的 DEV_DATABASE_URL)
// 硬编码拒绝连生产库,跟 db-reset 同一道闸。
import { readFileSync } from 'node:fs'
import pg from 'pg'

function loadEnv(file = '.env') {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch (_) {}
}

const 生产库 = 'jjgvvtrsnoqnoigukobi'

const A = { id: 'aaaaaaaa-0000-4000-8000-00000000000a', email: 'iso-a@test.local', mark: 'ISO_A_KANGAROO' }
const B = { id: 'bbbbbbbb-0000-4000-8000-00000000000b', email: 'iso-b@test.local', mark: 'ISO_B_ZEBRA' }

let client
let 失败 = []
const fail = (msg) => { 失败.push(msg); console.log('  ✗ ' + msg) }

/** 以某个登录用户的身份跑一段(事务里 set role + 假 JWT,PostgREST 同款机制) */
async function as(user, fn) {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: user.id, role: 'authenticated' })])
    const r = await fn()
    await client.query('commit')
    return r
  } catch (e) { await client.query('rollback').catch(() => {}); throw e }
}

/** 给一个用户种全套数据。每张表至少一行,标记串到处都是。 */
async function seed(u) {
  const M = u.mark
  return as(u, async () => {
    // profile / voice 已由注册触发器建好——写上标记
    await client.query(`update producer.profile set name = $1, website = 'https://x.test/' || $1`, [M])
    await client.query(`update producer.voice set agent_name = $1`, [M])
    const { rows: [p] } = await client.query(
      `insert into producer.pursuits (title, org) values ($1 || '_线', $1 || '_机构') returning id`, [M])
    const { rows: [c] } = await client.query(
      `insert into producer.contacts (name, email) values ($1 || '_人', lower($1) || '@ppl.test') returning id`, [M])
    const { rows: [w] } = await client.query(
      `insert into producer.works (title, body) values ($1 || '_作品', $1 || '_长描述') returning id`, [M])
    const { rows: [m] } = await client.query(
      `insert into producer.pursuit_messages (pursuit_id, role, content, gmail_message_id)
       values ($1, 'artist', $2 || '_一句话', $2 || '_gm1') returning id`, [p.id, M])
    await client.query(`insert into producer.deliverables (pursuit_id, kind, title, body) values ($1,'letter',$2||'_信',$2||'_信正文')`, [p.id, M])
    await client.query(`insert into producer.pursuit_threads (pursuit_id, gmail_thread_id) values ($1, $2 || '_th1')`, [p.id, M])
    await client.query(`insert into producer.pursuit_parties (pursuit_id, contact_id) values ($1, $2)`, [p.id, c.id])
    const { rows: [pr] } = await client.query(`select id from producer.profile`)
    await client.query(`insert into producer.pursuit_seen (pursuit_id, profile_id) values ($1, $2)`, [p.id, pr.id])
    await client.query(`insert into producer.contact_emails (contact_id, email) values ($1, lower($2) || '@more.test')`, [c.id, M])
    await client.query(`insert into producer.contact_orgs (contact_id, org) values ($1, $2 || '_org')`, [c.id, M])
    await client.query(`insert into producer.org_mailboxes (org, email) values ($1 || '_org', lower($1) || '@org.test')`, [M])
    const { rows: [acc] } = await client.query(
      `insert into producer.mail_accounts (address) values (lower($1) || '@me.test') returning id`, [M])
    await client.query(
      `insert into producer.mail_headers (gmail_message_id, account_id, gmail_thread_id, from_email, sent_at, counterpart_email, direction)
       values ($1 || '_gm2', $2, $1 || '_th1', lower($1) || '@me.test', now(), lower($1) || '@ppl.test', 'in')`, [M, acc.id])
    await client.query(`insert into producer.mail_label_audit (gmail_message_id, labels) values ($1 || '_gm2', array[$1 || '_label'])`, [M])
    await client.query(`insert into producer.letter_verdicts (gmail_message_id, needs_reply, why) values ($1 || '_gm2', true, $1 || '_理由')`, [M])
    await client.query(`insert into producer.message_tags (message_id, situation) values ($1, $2 || '_situ')`, [m.id, M])
    await client.query(`insert into producer.address_verdicts (email, verdict, why, decided_by) values (lower($1) || '@judge.test', 'person', $1 || '_理由', 'rule')`, [M])
    await client.query(`insert into producer.cue_marks (profile_id, subject_kind, subject_id, via, fact_at, mark) values ($1,'pursuit',$2,'email',current_date,'done')`, [pr.id, p.id])
    await client.query(`insert into producer.cue_judged (subject_kind, subject_id, judged_upto) values ('pursuit', $1, now())`, [p.id])
    await client.query(`insert into producer.tasks (name, type) values ($1 || '_任务', 'scout')`, [M])
    await client.query(`insert into producer.attachments (pursuit_id, filename) values ($1, $2 || '_附件.pdf')`, [p.id, M])
    // pulse 不用手动种:上面这些 insert 本身就会经 t_pulse_i 触发器给这个
    // 用户拨出自己那一行——它出现在 sweep 里,顺带证明 bump 归人了。
    // (stage_backup_0015 不种:0121 起新库里没有这张个人史备份表。)

    // ── 两个学员认识同一个策展人 ──────────────────────────
    // email 这类人间的自然键,单人版拿它当全局唯一没问题;多人之后
    // 唯一性必须按 (谁的, email) 算。A 和 B 都认识 curator@shared.test,
    // 都注册了 info@shared.test 这个机构信箱——谁都不该撞谁。
    const { rows: [c2] } = await client.query(
      `insert into producer.contacts (name, email) values ($1 || '_共同认识的策展人', 'curator@shared.test') returning id`, [M])
    await client.query(`insert into producer.contact_emails (contact_id, email) values ($1, 'curator2@shared.test')`, [c2.id])
    await client.query(`insert into producer.org_mailboxes (org, email) values ('SharedOrg', 'info@shared.test')`)
    await client.query(`insert into producer.mail_accounts (address) values ('team@shared.test')`)
    await client.query(`insert into producer.address_verdicts (email, verdict, why, decided_by) values ('curator@shared.test', 'person', $1 || '_共判', 'rule')`, [M])
    // 同一封信的 gmail id 出现在两个人的信箱里(转发、群发、抄送都会造成),
    // 或者纯粹撞 id——租户内唯一,不是全世界唯一。
    await client.query(
      `insert into producer.mail_headers (gmail_message_id, account_id, gmail_thread_id, from_email, sent_at, counterpart_email, direction)
       values ('shared_gm_dup', $1, 'shared_th_dup', 'curator@shared.test', now(), 'curator@shared.test', 'in')`, [acc.id])
    await client.query(`insert into producer.letter_verdicts (gmail_message_id, needs_reply, why) values ('shared_gm_dup', false, $1 || '_共同的一封信')`, [M])
    await client.query(`insert into producer.mail_label_audit (gmail_message_id, labels) values ('shared_gm_dup', array['INBOX'])`)
    return { p: p.id, c: c.id, w: w.id, m: m.id }
  })
}

/** 以 u 的身份扫每张表 + 每个视图,断言:别人的标记零出现;自己的看得见。 */
async function sweep(u, other) {
  const tables = (await client.query(
    `select c.relname as r, 'producer.' || c.relname as q from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='producer' and c.relkind='r' order by 1`)).rows
  const views = (await client.query(
    `select c.relname as r, 'public.' || c.relname as q from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='v' and c.relname like 'v\\_pa\\_%' order by 1`)).rows

  let sawOwn = 0
  await as(u, async () => {
    for (const { r, q } of [...tables, ...views]) {
      let rows
      try { rows = (await client.query(`select * from ${q} limit 500`)).rows }
      catch (e) { fail(`${u.mark} 读 ${q} 报错:${e.message.split('\n')[0]}`); continue }
      const text = JSON.stringify(rows)
      if (text.includes(other.mark)) fail(`${u.mark} 在 ${q} 里看见了 ${other.mark}`)
      if (text.includes(u.mark)) sawOwn++
    }
  })
  if (sawOwn < 15) fail(`${u.mark} 只在 ${sawOwn} 个对象里看见自己的数据——太少,怀疑测试空转`)
  console.log(`  ✓ ${u.mark}:扫了 ${tables.length} 张表 + ${views.length} 个视图,自己的数据出现在 ${sawOwn} 处,对方标记 0 处`)
}

/** 关键函数探针:拿着对方的 id 调,必须要么报错、要么拿不到东西。 */
async function probes(u, other, otherIds) {
  await as(u, async () => {
    const { rows: [{ ctx }] } = await client.query(
      `select public.pa_brain_context($1) as ctx`, [otherIds.p])
    const t = JSON.stringify(ctx)
    if (t.includes(other.mark)) fail(`pa_brain_context(${other.mark} 的线) 泄露了内容`)
    if (ctx?.pursuit != null) fail(`pa_brain_context 拿到了别人的 pursuit`)

    const { rows: [{ pctx }] } = await client.query(
      `select public.pa_brain_person_context($1) as pctx`, [otherIds.c])
    if (JSON.stringify(pctx).includes(other.mark)) fail(`pa_brain_person_context 泄露了 ${other.mark}`)

    await client.query('savepoint sp')
    try {
      await client.query(`select public.pa_set_stage($1, 'won')`, [otherIds.p])
      fail(`pa_set_stage 改别人的线没报错`)
    } catch (_) { await client.query('rollback to savepoint sp') /* 该报错 */ }

    await client.query(`select public.pa_set_profile(p_name => '${u.mark}_改名')`)
    await client.query(`select public.pa_set_voice(p_agent_name => '${u.mark}_agent')`)
  })
  // 用 postgres(看得到全部)验证:改动只落在自己行上
  const { rows } = await client.query(
    `select name from producer.profile where owner = $1`, [other.id])
  if (rows[0] && rows[0].name.includes(u.mark)) fail(`pa_set_profile 改到了别人的档案`)
  console.log(`  ✓ ${u.mark}:函数探针(brain_context / person_context / set_stage / set_profile / set_voice)全部挡住`)
}

async function main() {
  loadEnv()
  const url = process.env.DEV_DATABASE_URL
  if (!url) throw new Error('.env 里没有 DEV_DATABASE_URL')
  if (url.includes(生产库)) throw new Error('拒绝连生产库')
  client = new pg.Client({ connectionString: url })
  await client.connect()

  console.log('清掉上回的测试用户(级联删掉他们的全部数据)…')
  await client.query(`delete from auth.users where email like 'iso-%@test.local'`)

  console.log('建两个用户(注册触发器应当自动发 profile/voice)…')
  for (const u of [A, B]) {
    await client.query(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                               raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(),
               '{"provider":"email"}', '{}', now(), now())`, [u.id, u.email])
    const { rows } = await client.query(`select 1 from producer.profile where owner = $1`, [u.id])
    if (!rows.length) fail(`注册触发器没给 ${u.email} 建 profile`)
  }

  console.log('各种一整套数据…')
  const idsA = await seed(A)
  const idsB = await seed(B)

  console.log('\nA 的视角:')
  await sweep(A, B)
  await probes(A, B, idsB)
  console.log('B 的视角:')
  await sweep(B, A)
  await probes(B, A, idsA)

  console.log('anon(没登录)的视角:')
  await client.query('begin')
  await client.query('set local role anon')
  let anonBlocked = 0
  for (const probe of [`select * from public.v_pa_pursuits limit 1`,
                       `select * from producer.pursuits limit 1`,
                       `select public.pa_ledger()`]) {
    try { await client.query(probe); fail(`anon 居然跑通了:${probe}`) }
    catch (_) { anonBlocked++; await client.query('rollback'); await client.query('begin'); await client.query('set local role anon') }
  }
  await client.query('rollback')
  console.log(`  ✓ anon 三条探针全部被挡(${anonBlocked}/3)`)

  console.log('\n' + (失败.length ? `🔴 ${失败.length} 处失败` : '🟢 隔离成立:每张表、每个视图、关键函数、anon,全部干净'))
  await client.end()
  process.exit(失败.length ? 1 : 0)
}

main().catch((e) => { console.error('炸了:', e.message); process.exit(1) })
