// brain/local/migrate.js —— 本地库:打开、前言、按序跑迁移、记账。
//
// 这是设计稿(2026-09-16)6.4 规矩 2 的唯一例外:这里能碰裸 SQL,因为它就是把
// supabase/migrations 原样喂给 PGlite 的那只手。别的地方一律走 pa_* / v_pa_*。
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrationOrder } from '../../scripts/migration-order.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// 开发时在仓库的 supabase/migrations;打包后迁移文件在字节码旁边的 migrations/
export const MIGRATIONS_DIR = existsSync(join(HERE, '..', '..', 'supabase', 'migrations'))
  ? join(HERE, '..', '..', 'supabase', 'migrations')
  : join(HERE, 'migrations')

/** 打开(或新建)<dataDir>/db,跑前言。前言幂等,每次开都跑。 */
export async function openLocalDb(dataDir) {
  const pg = new PGlite(join(dataDir, 'db'))
  await pg.exec(readFileSync(join(HERE, 'preamble.sql'), 'utf8'))
  return pg
}

export async function setLocalUid(pg, uid) {
  await pg.query(`select set_config('fairwind.uid', $1, false)`, [uid])
}

// ── 身份 ──────────────────────────────────────────────────────
// PGlite 的会话是超级用户。开完库、跑完迁移之后切成 authenticated:
// 行级权限从此跟云端一样生效,definer/invoker、grant 那一套全部照旧——
// 本机模式不是"没有门",是"同一道门,一个人"。
// 迁移和注册要回到超级用户做(建对象、写 auth.users),做完切回去。
export async function assumeUser(pg) {
  await pg.exec('set role authenticated')
}

async function asSuperuser(pg, fn) {
  const { rows } = await pg.query('select current_user as u')
  const was = rows[0].u
  if (was !== 'postgres') await pg.exec('reset role')
  try { return await fn() } finally { if (was !== 'postgres') await pg.exec(`set role ${was}`) }
}

/** 往 auth.users 插一行;0137 的触发器随即造出这个人的 profile / voice。 */
export async function registerLocalUser(pg, { id, email }) {
  await asSuperuser(pg, () =>
    pg.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [id, email]))
}

/**
 * 按 migrationOrder 跑没记过的迁移,每支一个事务,记进 producer_meta.applied。
 * 装机和更新调的是同一个函数。
 */
export async function applyMigrations(pg, opts = {}) {
  return asSuperuser(pg, () => applyAsSuperuser(pg, opts))
}

async function applyAsSuperuser(pg, { fresh = true, dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  const files = migrationOrder(dir, { fresh })
  const { rows } = await pg.query('select filename from producer_meta.applied')
  const done = new Set(rows.map((r) => r.filename))
  const applied = []
  for (const f of files) {
    if (done.has(f)) continue
    const sql = readFileSync(join(dir, f), 'utf8')
    try {
      await pg.exec('begin')
      await pg.exec(sql)
      await pg.query('insert into producer_meta.applied (filename) values ($1)', [f])
      await pg.exec('commit')
      applied.push(f); log(`  ✓ ${f}`)
    } catch (err) {
      await pg.exec('rollback').catch(() => {})
      throw new Error(`迁移 ${f} 失败:${err.message.split('\n')[0]}`)
    }
  }
  return { applied, skipped: files.length - applied.length }
}
