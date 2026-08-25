// 连库的身份,双模:
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

/** 建客户端。mode: 'service'(老路)| 'user'(学员路)。配置不对就抛,话说清楚。 */
export function makeDb() {
  const url = process.env.SUPABASE_URL
  if (!url) throw new Error('brain/.env 里缺 SUPABASE_URL')
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (service) {
    return { db: createClient(url, service, { auth: { persistSession: false } }), mode: 'service' }
  }
  const anon = process.env.SUPABASE_ANON_KEY
  if (!anon) {
    throw new Error('brain/.env 里要么填 SUPABASE_SERVICE_ROLE_KEY(个人版老路),' +
                    '要么填 SUPABASE_ANON_KEY 再跑一次 npm run db:login(学员路)')
  }
  const db = createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true, storage: fileStorage, storageKey: 'fairwind' },
  })
  return { db, mode: 'user' }
}

/** 学员路必须已登录。没登录就抛,告诉人怎么修。 */
export async function requireUser(db) {
  const { data, error } = await db.auth.getUser()
  if (error || !data?.user) {
    throw new Error('还没登录(或会话过期)。在 brain/ 里跑:npm run db:login')
  }
  return data.user
}
