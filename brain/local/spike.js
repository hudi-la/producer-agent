// brain/local/spike.js —— ①的验证:字节码 + 自带 node 上,PGlite 能建库、SDK 能答话。可弃。
import { PGlite } from '@electric-sql/pglite'
// 静态 import,不用 import():bytenode 用 vm.Script 跑,里头没有动态 import 的回调。
// Node 24 的 require(esm) 能同步装 ESM 包,esbuild 把静态 import 翻成 require 正好。
import { query } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'fairwind-spike-'))
  const pg = new PGlite(dir)
  await pg.exec(readFileSync(join(HERE, 'preamble.sql'), 'utf8'))
  console.log('前言 ✓  (create role / auth schema 在 PGlite 上能跑)')
  const first = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()[0]
  await pg.exec(readFileSync(join(ROOT, 'supabase/migrations', first), 'utf8'))
  const { rows } = await pg.query(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='producer' and c.relkind='r'`)
  console.log(`迁移 ${first} ✓  producer 里 ${rows[0].n} 张表`)
  await pg.query(`select set_config('fairwind.uid', $1, false)`, ['11111111-1111-4111-8111-111111111111'])
  const u = await pg.query('select auth.uid() as uid')
  console.log(`auth.uid() = ${u.rows[0].uid} ✓`)
  await pg.close()

  let text = ''
  for await (const m of query({ prompt: '只回一个字：好', options: { maxTurns: 1, allowedTools: [] } })) {
    if (m.type === 'result') text = m.result
  }
  console.log(`SDK 子进程 ✓  它说:${String(text).trim().slice(0, 20)}`)
  console.log('\n全部通过。')
}
main().catch((e) => { console.error('✗', e); process.exit(1) })
