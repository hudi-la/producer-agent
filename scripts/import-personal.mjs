// 把个人版(他自己那份生产库)的内容一次搬进线上(托管库)他名下。2026-10-07。
//
//   node scripts/import-personal.mjs              干跑:整批在一个事务里真写一遍,报数,然后**整个撤回**
//   node scripts/import-personal.mjs --apply      同样写一遍,报数,提交
//
// 连接:~/.fairwind-personal.env 的 PERSONAL_DATABASE_URL(个人版,只读会话)
//       ~/.fairwind-hosted.env 的 DEV_DATABASE_URL(线上库)
// 认人:--email(默认 hudi.creates@gmail.com)→ 线上 auth.users 里那个人的 id
//
// 规矩:
//   · 个人版只读(default_transaction_read_only),这个脚本不往个人版写一个字节
//   · 编号原样搬(卡片、人、信之间的关联靠编号,换了就断);owner 一律写成他线上的 id
//   · 两边各有一条的单例(档案、信箱、找机会任务)不新插,个人版的编号换成线上那条的编号
//   · 线上已经有的不覆盖(on conflict do nothing),只有两处以个人版为准:档案内容、地址判定
//   · 不搬:pulse / pulse_areas(系统计数)、stage_backup_*(旧备份)、member_settings / judgment_docs / voice(个人版没有)
//   · 整批一个事务;外键检查推到最后(session_replication_role=replica 期间不查,提交前自己查一遍断链)
//   · 可以重跑:第二次跑每张表都是 0 行新增
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const APPLY = process.argv.includes('--apply')
const EMAIL = (process.argv.find((a) => a.startsWith('--email=')) || '--email=hudi.creates@gmail.com').split('=')[1]
const envOf = (file, key) => {
  const m = readFileSync(`${homedir()}/${file}`, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  if (!m) throw new Error(`${file} 里没有 ${key}`)
  return m[1].trim()
}

const SKIP = new Set(['pulse', 'pulse_areas', 'member_settings', 'judgment_docs', 'voice'])
// 先父后子。pursuits ↔ pursuit_messages 互相指,靠最后统一查外键兜住
const ORDER = ['profile', 'works', 'tasks', 'contacts', 'contact_emails', 'contact_orgs', 'org_mailboxes', 'mail_accounts',
  'mail_headers', 'mail_label_audit', 'address_verdicts', 'pursuits', 'pursuit_messages', 'pursuit_threads', 'pursuit_parties',
  'deliverables', 'attachments', 'message_tags', 'opportunities', 'letter_verdicts', 'thread_marks', 'studio_messages',
  'contact_seen', 'pursuit_seen', 'cue_marks', 'cue_judged']

async function main() {
  const P = new pg.Client({ connectionString: envOf('.fairwind-personal.env', 'PERSONAL_DATABASE_URL') })
  const H = new pg.Client({ connectionString: envOf('.fairwind-hosted.env', 'DEV_DATABASE_URL') })
  await P.connect(); await H.connect()
  await P.query('set default_transaction_read_only = on')

  const { rows: [u] } = await H.query('select id from auth.users where lower(email) = lower($1)', [EMAIL])
  if (!u) throw new Error(`线上没有 ${EMAIL} 这个账号`)
  const me = u.id
  console.log(`${APPLY ? '正式导入' : '干跑(最后整个撤回)'} → ${EMAIL}(${me})\n`)

  const colsOf = async (c, t) => (await c.query(
    `select column_name from information_schema.columns where table_schema = 'producer' and table_name = $1 order by ordinal_position`, [t])).rows.map((r) => r.column_name)
  const personalTables = new Set((await P.query(`select table_name from information_schema.tables where table_schema = 'producer' and table_type = 'BASE TABLE'`)).rows.map((r) => r.table_name))
  const hostedTables = new Set((await H.query(`select table_name from information_schema.tables where table_schema = 'producer' and table_type = 'BASE TABLE'`)).rows.map((r) => r.table_name))
  const leftOut = [...personalTables].filter((t) => !ORDER.includes(t) && !SKIP.has(t))
  if (leftOut.filter((t) => !t.startsWith('stage_backup_')).length) throw new Error('这几张表没想好怎么搬,先停:' + leftOut.join('、'))

  // ── 单例:个人版编号 → 线上编号 ──
  const one = async (c, sql, a = []) => (await c.query(sql, a)).rows[0]
  const pProfile = await one(P, 'select * from producer.profile limit 1')
  const hProfile = await one(H, 'select * from producer.profile where owner = $1', [me])
  const pAcct = (await P.query('select * from producer.mail_accounts')).rows
  const hAcct = (await H.query('select * from producer.mail_accounts where owner = $1', [me])).rows
  const pScout = await one(P, `select * from producer.tasks where type = 'scout_aggregators' limit 1`)
  const hScout = await one(H, `select * from producer.tasks where owner = $1 and type = 'scout_aggregators' limit 1`, [me])
  const remap = { profile: {}, mail_accounts: {}, tasks: {} }
  if (pProfile && hProfile) remap.profile[pProfile.id] = hProfile.id
  for (const a of pAcct) { const h = hAcct.find((x) => x.address.toLowerCase() === a.address.toLowerCase()); if (h) remap.mail_accounts[a.id] = h.id }
  if (pScout && hScout) remap.tasks[pScout.id] = hScout.id
  // 哪些列指向这三样(按线上的外键现查)
  const refCols = (await H.query(`
    select conrelid::regclass::text t, confrelid::regclass::text r, a.attname col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f' and c.connamespace = 'producer'::regnamespace
       and confrelid::regclass::text in ('producer.profile', 'producer.mail_accounts', 'producer.tasks')`)).rows
  const mapFor = {}   // 表 → { 列: 映射 }
  for (const r of refCols) { const t = r.t.replace('producer.', ''); (mapFor[t] ||= {})[r.col] = remap[r.r.replace('producer.', '')] }

  await H.query('begin')
  await H.query(`set local session_replication_role = replica`)
  const report = []
  const files = []   // [个人版 key, 线上 key, mime]
  try {
    for (const t of ORDER) {
      if (!personalTables.has(t) || !hostedTables.has(t)) { report.push([t, '—', '某一边没有这张表']); continue }
      const pc = await colsOf(P, t), hc = await colsOf(H, t)
      const jsonCols = new Set((await H.query(`select column_name from information_schema.columns where table_schema = 'producer' and table_name = $1 and data_type in ('json', 'jsonb')`, [t])).rows.map((r) => r.column_name))
      const cols = pc.filter((c) => hc.includes(c) && c !== 'owner')
      const rows = (await P.query(`select ${cols.map((c) => `"${c}"`).join(', ')} from producer.${t}`)).rows
      let inserted = 0, note = ''

      if (t === 'profile') {
        // 线上那条是空的:内容以个人版为准,编号用线上的
        const keep = cols.filter((c) => !['id', 'created_at'].includes(c))
        const r = await H.query(`update producer.profile set ${keep.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} where owner = $1`, [me, ...keep.map((c) => (jsonCols.has(c) && pProfile[c] != null ? JSON.stringify(pProfile[c]) : pProfile[c]))])
        report.push([t, rows.length, `更新线上那条 ${r.rowCount} 行`]); continue
      }
      if (t === 'mail_accounts') { report.push([t, rows.length, `线上已有 ${hAcct.map((a) => a.address).join('、')},不新插,编号换成线上的`]); continue }
      if (t === 'tasks' && pScout && hScout) {
        // 「每周找机会」:线上那条的提示词换成他改过的;其余任务照搬
        await H.query(`update producer.tasks set prompt = $2, name = $3, enabled = $4, run_every = $5, run_weekday = $6, run_hour = $7, config = $8 where id = $1`,
          [hScout.id, pScout.prompt, pScout.name, pScout.enabled, pScout.run_every, pScout.run_weekday, pScout.run_hour, JSON.stringify(pScout.config ?? {})])
        note = '「每周找机会」换成个人版的提示词;'
      }

      const maps = mapFor[t] || {}
      const src = rows.filter((r) => !(t === 'tasks' && pScout && r.id === pScout.id))
      const conflict = t === 'address_verdicts'
        ? `on conflict (owner, email) do update set ${cols.filter((c) => !['id', 'email'].includes(c)).map((c) => `"${c}" = excluded."${c}"`).join(', ')}`
        : 'on conflict do nothing'
      // 成批写:一批几百行一次往返(一行一次往返的话一万多行要半小时,还一直占着事务)。
      // jsonb_populate_recordset 按线上的列类型把 JSON 还原成行——json 列、text[] 列、时间都不用自己转
      let skipped = []
      const recs = src.map((r) => Object.fromEntries(cols.map((c) => [c, maps[c] && r[c] != null && maps[c][r[c]] ? maps[c][r[c]] : r[c]])))
      // 附件:线上的桶只认「路径第一段 = 主人」(0153),个人版的旧 key 没有这一段 → 加上;文件本体提交后再搬
      if (t === 'attachments') for (const r of recs) if (r.storage_key && !r.storage_key.startsWith(me + '/')) { files.push([r.storage_key, `${me}/${r.storage_key}`, r.mime]); r.storage_key = `${me}/${r.storage_key}` }
      const colList = cols.map((c) => `"${c}"`).join(', ')
      for (let i = 0; i < recs.length; i += 400) {
        const chunk = recs.slice(i, i + 400)
        try {
          const res = await H.query(`insert into producer.${t} (owner, ${colList}) select $1, ${colList} from jsonb_populate_recordset(null::producer.${t}, $2::jsonb) ${conflict} returning ${t === 'opportunities' ? 'title' : '1'}`,
            [me, JSON.stringify(chunk)])
          inserted += res.rowCount
          if (t === 'opportunities') { const got = new Set(res.rows.map((x) => x.title)); skipped.push(...chunk.filter((x) => !got.has(x.title)).map((x) => x.title)) }
        } catch (e) { throw new Error(`${t} 第 ${i + 1}–${i + chunk.length} 行写不进去:${e.message}`) }
      }
      if (skipped.length) note += `撞名没进:${skipped.length} 条(${skipped.slice(0, 3).join(' / ')}${skipped.length > 3 ? '…' : ''});`
      report.push([t, rows.length, `${note}新写 ${inserted} 行${rows.length - inserted - (src.length < rows.length ? 1 : 0) > 0 ? `,线上已有 ${src.length - inserted}` : ''}`])
    }

    // 外键兜底:replica 期间没查,提交前逐条外键自己查一遍断链
    await H.query(`set local session_replication_role = origin`)
    const fks = (await H.query(`
      select conrelid::regclass::text t, confrelid::regclass::text r, conname,
             (select array_agg(attname::text order by k.n) from unnest(conkey) with ordinality k(a, n) join pg_attribute on attrelid = conrelid and attnum = k.a) cc,
             (select array_agg(attname::text order by k.n) from unnest(confkey) with ordinality k(a, n) join pg_attribute on attrelid = confrelid and attnum = k.a) rc
        from pg_constraint where contype = 'f' and connamespace = 'producer'::regnamespace and confrelid <> 'auth.users'::regclass`)).rows
    const broken = []
    for (const f of fks) {
      const on = f.cc.map((c, i) => `x."${c}" = y."${f.rc[i]}"`).join(' and ')
      const notNull = f.cc.map((c) => `x."${c}" is not null`).join(' and ')
      const { rows: [{ n }] } = await H.query(`select count(*)::int n from ${f.t} x where x.owner = $1 and ${notNull} and not exists (select 1 from ${f.r} y where ${on})`, [me])
      if (n) broken.push(`${f.t}.${f.cc.join('+')} → ${f.r}:${n} 行指向不存在的`)
    }

    console.log('表 | 个人版 | 结果')
    for (const r of report) console.log(r.join(' | '))
    console.log(broken.length ? `\n⚠️ 断链:\n  ${broken.join('\n  ')}` : '\n✓ 外键全部接得上')
    if (APPLY && !broken.length) {
      await H.query('commit'); console.log('\n已提交。')
      await copyFiles(files)
    } else if (files.length) console.log(`\n附件文件 ${files.length} 个,正式导入时搬:${files.map((f) => f[0].split('/').pop()).join('、')}`)
    else { await H.query('rollback'); console.log(APPLY ? '\n有断链,没提交,整个撤回了。' : '\n干跑:整个撤回了,线上一行没变。') }
  } catch (e) {
    await H.query('rollback').catch(() => {})
    throw e
  } finally { await P.end(); await H.end() }
}

/** 附件本体:个人版的桶 → 线上的桶。两边都用 service_role(个人版 brain/.env,线上 ~/.fairwind-hosted.env) */
async function copyFiles(files) {
  if (!files.length) return
  const { createClient } = await import('@supabase/supabase-js')
  const pEnv = Object.fromEntries(readFileSync(new URL('../brain/.env', import.meta.url).pathname.replace('/.claude/worktrees/workshop-edition', ''), 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]))
  const src = createClient(pEnv.SUPABASE_URL, pEnv.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const dst = createClient(envOf('.fairwind-hosted.env', 'SUPABASE_URL'), envOf('.fairwind-hosted.env', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  for (const [from, to, mime] of files) {
    const dl = await src.storage.from('pursuit-files').download(from)
    if (dl.error) { console.log(`  ⚠️ ${from} 从个人版下不来:${dl.error.message}`); continue }
    const up = await dst.storage.from('pursuit-files').upload(to, Buffer.from(await dl.data.arrayBuffer()), { contentType: mime || 'application/octet-stream', upsert: true })
    console.log(up.error ? `  ⚠️ ${to} 传不上:${up.error.message}` : `  ✓ 附件 ${from.split('/').pop()} 搬好了`)
  }
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
