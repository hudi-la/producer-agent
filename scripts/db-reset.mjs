// 从零建库:清空 → 按真实顺序跑完全部迁移 → 报告。
//
// 这不是临时工具。它有两个长期用途:
//   1. 「一台干净机器能不能建起来」的唯一证明(路线总纲 ② 的验收项)。
//      想是想不出来的——106 支迁移里任何一支依赖了「上一支刚好留下的状态」,
//      只有真的从零跑一遍才会暴露。
//   2. 做权限规则时每改一次就要清空重建。没有它,RLS 迭代不动。
//
// 顺序**不看文件名**,看 scripts/migration-order.mjs——0111–0115 有十支重号,
// 而其中几支是 create or replace 覆盖同一个函数,排错了拿到旧版本函数体
// 而且不报错。
//
//   node scripts/db-reset.mjs            跑一遍(不清空,增量)
//   node scripts/db-reset.mjs --wipe     先清空 producer schema 再跑
//   node scripts/db-reset.mjs --fresh    不清空,但按**新装**顺序跑(跳过数据修复)——给一个本来就空的新项目建库用(2026-10-02 托管)
//   node scripts/db-reset.mjs --sync     只跑记账表(supabase_migrations.schema_migrations)里没有的,跑完记上——托管的库发新迁移就用它
//
// 连的是 .env 里的 DEV_DATABASE_URL。**脚本拒绝连生产库**(见下面那道闸)。
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { migrationOrder } from './migration-order.mjs'

// .env 自己读,不引 dotenv:少一个依赖,而且这脚本要能在学员机器上裸跑。
function loadEnv(file = '.env') {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch (_) {}
}

// ── 生产库的闸 ─────────────────────────────────────────────
// 这个脚本会 drop schema cascade。指错库 = 他天天在用的全部往来当场没了。
// 所以硬编码生产库的 ref 挡在这儿:宁可误伤,不可漏放。
const 生产库 = 'jjgvvtrsnoqnoigukobi'

async function main() {
  loadEnv()
  const url = process.env.DEV_DATABASE_URL
  if (!url) throw new Error('.env 里没有 DEV_DATABASE_URL')
  if (url.includes(生产库)) {
    throw new Error(`拒绝执行:DEV_DATABASE_URL 指向生产库 ${生产库}。这个脚本会 drop schema。`)
  }

  const wipe = process.argv.includes('--wipe')
  // 清空重建 = 新装,跳过一次性数据修复(它们修的是他库里的历史行)
  const sync = process.argv.includes('--sync')
  const fresh = wipe || sync || process.argv.includes('--fresh')
  let files = migrationOrder('supabase/migrations', { fresh })
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  if (sync) {
    // 记账表是 record-migrations.mjs / supabase CLI 写的那张;没有就当什么都没跑过
    const { rows } = await client.query(`select version from supabase_migrations.schema_migrations`).catch(() => ({ rows: [] }))
    const done = new Set(rows.map((r) => r.version))
    files = files.filter((f) => !done.has(f.slice(0, 4)))
    console.log(`记账表里 ${done.size} 支已跑过,这次 ${files.length} 支`)
  }
  console.log(`连上了 · ${files.length} 支迁移 · ${wipe ? '先清空' : sync ? '只跑没记过的' : fresh ? '新装(不清空)' : '增量'}`)

  if (wipe) {
    await client.query('drop schema if exists producer cascade')
    // public 里那些 v_pa_* 视图和 pa_* 函数也是这套东西的一部分,一起清。
    // 但**不动 public 本身**——同一个项目里可能还有别人的表。
    await client.query(`
      do $$
      declare r record;
      begin
        for r in select p.oid::regprocedure as sig from pg_proc p
                  join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'pa\\_%'
        loop execute 'drop function if exists ' || r.sig || ' cascade'; end loop;
        for r in select c.relname from pg_class c
                  join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'v\\_pa\\_%'
        loop execute 'drop view if exists public.' || quote_ident(r.relname) || ' cascade'; end loop;
      end $$;
    `)
    console.log('  清空了 producer schema + public 里的 pa_* / v_pa_*')
  }

  let ok = 0
  const failed = []
  for (const [i, f] of files.entries()) {
    const sql = readFileSync('supabase/migrations/' + f, 'utf8')
    const n = String(i + 1).padStart(3, ' ')
    try {
      // 每支各自一个事务:一支失败不会把前面成功的带走,便于定位。
      await client.query('begin')
      await client.query(sql)
      await client.query('commit')
      ok++
      if (sync) await client.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing', [f.slice(0, 4), f.slice(5, -4)])
      process.stdout.write(`\r  ${n}/${files.length} ✓ ${f.slice(0, 52).padEnd(52)}`)
    } catch (err) {
      await client.query('rollback').catch(() => {})
      failed.push({ n: i + 1, f, msg: err.message })
      process.stdout.write(`\r  ${n}/${files.length} ✗ ${f}\n`)
      console.log(`      ${err.message.split('\n')[0]}`)
    }
  }
  process.stdout.write('\n')

  console.log(`\n跑完:${ok}/${files.length} 支成功`)
  if (failed.length) {
    console.log(`\n失败 ${failed.length} 支:`)
    for (const x of failed) console.log(`  ${x.n} ${x.f}\n     ${x.msg.split('\n')[0]}`)
  }

  const { rows } = await client.query(`
    select
      (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='producer' and c.relkind='r') as 表,
      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname like 'pa\\_%') as 函数,
      (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind='v' and c.relname like 'v\\_pa\\_%') as 视图
  `)
  console.log(`\n建出来:${rows[0].表} 张表 · ${rows[0].函数} 个 pa_* 函数 · ${rows[0].视图} 个 v_pa_* 视图`)

  await client.end()
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => { console.error('炸了:', e.message); process.exit(1) })
