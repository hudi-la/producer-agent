// 连库的身份,三模:
//
//   本机(学员,2026-09-16 起):FAIRWIND_DATA_DIR 在、云端钥匙都不在 → PGlite。
//     数据、附件、设置全在那个目录底下。没有任何云端钥匙,也没有登录这回事;
//     "我是谁"是 settings.json 里生成一次的 uuid。
//
//   老路(个人版):SUPABASE_SERVICE_ROLE_KEY 在 .env 里 → 万能钥匙,绕过
//     行级权限。合并过渡期保留;多租户彻底接完后这条路退役。
//   学员路:SUPABASE_ANON_KEY + 一次登录(npm run db:login)。会话落在
//     brain/.supabase-session.json(gitignore),进程里自动续期,重启自动
//     恢复。**这个身份被行级权限管着**——brain 只看得见这个学员自己的行,
//     机器上不存在能读别人数据的钥匙。
//
// 为什么是文件不是环境变量:refresh token 每次续期都会换,得写回去;
// .env 是人手填的,不该被程序改。
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './local/migrate.js'
import { makeLocalDb } from './local/localdb.js'
import { loadSettings } from './local/settings.js'

const SESSION_FILE = fileURLToPath(new URL('./.supabase-session.json', import.meta.url))

function readStore() {
  try { return JSON.parse(readFileSync(SESSION_FILE, 'utf8')) } catch { return {} }
}

// supabase-js 认这个形状的 storage(getItem/setItem/removeItem)。
const fileStorage = {
  getItem: (k) => readStore()[k] ?? null,
  setItem: (k, v) => { const o = readStore(); o[k] = v; writeFileSync(SESSION_FILE, JSON.stringify(o)) },
  removeItem: (k) => { const o = readStore(); delete o[k]; writeFileSync(SESSION_FILE, JSON.stringify(o)) },
}

/**
 * 建客户端。mode: 'service'(老路)| 'user'(云端学员路)| 'local'(本机库)。
 * 异步:本机模式要开库、跑迁移。配置不对就抛,话说清楚。
 */
export async function makeDb() {
  const url = process.env.SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anon = process.env.SUPABASE_ANON_KEY
  const dataDir = process.env.FAIRWIND_DATA_DIR

  if (url && service) return { db: createClient(url, service, { auth: { persistSession: false } }), mode: 'service' }
  if (url && anon) {
    const db = createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true, storage: fileStorage, storageKey: 'fairwind' },
    })
    return { db, mode: 'user' }
  }
  if (dataDir) {
    const settings = loadSettings(dataDir)
    const pg = await openLocalDb(dataDir)
    await applyMigrations(pg, { fresh: true, log: (s) => console.log(s) })
    await setLocalUid(pg, settings.uid)
    if (settings.email) await registerLocalUser(pg, { id: settings.uid, email: settings.email })
    await assumeUser(pg)   // 从此以 authenticated 身份跑:行级权限跟云端一样生效
    const db = await makeLocalDb({ pg, dataDir, user: { id: settings.uid, email: settings.email },
      brainUrl: `http://localhost:${process.env.BRAIN_PORT || 8788}` })
    return { db, mode: 'local', pg, settings }
  }
  throw new Error('brain/.env 里要么填 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY(个人版),' +
                  '要么填 SUPABASE_URL + SUPABASE_ANON_KEY 再跑 npm run db:login(云端学员),' +
                  '要么设 FAIRWIND_DATA_DIR(本机库)')
}

/** 学员路必须已登录。没登录就抛,告诉人怎么修。 */
export async function requireUser(db) {
  const { data, error } = await db.auth.getUser()
  if (error || !data?.user) {
    throw new Error('还没登录(或会话过期)。在 brain/ 里跑:npm run db:login')
  }
  return data.user
}
