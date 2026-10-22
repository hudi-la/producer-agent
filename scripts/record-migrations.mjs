// 把 db-reset.mjs 跑过的迁移记进 Supabase 自己的记账表(supabase_migrations.schema_migrations)。
//
// db-reset 只管建,不记账——它是给 dev 库反复清空重建用的。托管的库建好以后要让 Supabase 后台的
// 「Last migration」和 supabase CLI 都知道「这些已经跑过」,不然下次 db push 会把 0001 再跑一遍。
// 记的名字就是文件名去掉 .sql(CLI 的写法:version = 开头那四位,name = 其余)。
//
//   DEV_DATABASE_URL=… node scripts/record-migrations.mjs
import pg from 'pg'
import { migrationOrder } from './migration-order.mjs'

const url = process.env.DEV_DATABASE_URL
if (!url) { console.error('缺 DEV_DATABASE_URL'); process.exit(2) }
const files = migrationOrder('supabase/migrations', { fresh: true })
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('create schema if not exists supabase_migrations')
await c.query('create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)')
let n = 0
for (const f of files) {
  const version = f.slice(0, 4), name = f.slice(5, -4)
  const r = await c.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing', [version, name])
  n += r.rowCount
}
const { rows } = await c.query('select count(*)::int as n from supabase_migrations.schema_migrations')
console.log(`记了 ${n} 支,表里现在 ${rows[0].n} 支`)
await c.end()
