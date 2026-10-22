// brain/modules.js —— 模块是能力开关,不是 schema 分区(设计稿 2026-09-16 D5):表全建,
// 路由/定时器/工具/界面按开关门控。
//
//   profile   档案、作品、语气、书桌
//   pursuits  机会线、人、时间线、状态机、写信稿、scout      ← 要 profile
//   mail      Gmail、归线归人、分诊、陌生人                    ← 要 pursuits
//
// 云端模式(作者)永远全开——功能只增不减。本机模式读 <数据目录>/modules.json,缺省只开档案层。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const MODULES = ['profile', 'pursuits', 'mail']
export const DEPS = { profile: [], pursuits: ['profile'], mail: ['pursuits'] }
const DEFAULT = { profile: true, pursuits: false, mail: false }
const FILE = (dir) => join(dir, 'modules.json')

export function loadModules({ dataDir, mode }) {
  if (mode !== 'local') return { profile: true, pursuits: true, mail: true, canToggle: false }
  const s = existsSync(FILE(dataDir)) ? { ...DEFAULT, ...JSON.parse(readFileSync(FILE(dataDir), 'utf8')) } : { ...DEFAULT }
  return { ...s, profile: true, canToggle: true }
}

export function setModules({ dataDir, mode }, patch) {
  if (mode !== 'local') throw new Error('云端模式下模块永远全开,改不了')
  const s = loadModules({ dataDir, mode })
  for (const [name, on] of Object.entries(patch)) {
    if (!MODULES.includes(name)) continue
    if (on) { s[name] = true; for (const d of DEPS[name]) s[d] = true }                                   // 开 X 先开它要的
    else { for (const m of MODULES) if (DEPS[m].includes(name)) s[m] = false; s[name] = false }           // 关 X 先关要它的
  }
  s.profile = true
  const { canToggle, ...disk } = s
  writeFileSync(FILE(dataDir), JSON.stringify(disk, null, 2))
  return s
}

// 路由归属。前缀匹配,长的先;没列的一律算 pursuits(主区的活)——宁可多关,不可漏开。
// /chat 三条归 profile:书桌(档案里的一条)和机会线共用这条路,主人在 body 里——
// 关了 pursuits 前端就不会拿机会线来聊,所以路由层只要保证书桌能聊。
const ROUTE_MODULE = [
  ['/health', 'core'], ['/mcp', 'core'], ['/mcp-guide', 'core'], ['/me', 'core'], ['/setup', 'core'], ['/modules', 'core'], ['/db/', 'core'], ['/files/', 'core'],
  ['/chat', 'profile'], ['/judgments/', 'profile'],   // 判据文档是人的东西,机会线关着也能看、能开关
  ['/mail/', 'mail'], ['/gmail-draft', 'mail'], ['/sync', 'mail'], ['/refresh', 'mail'], ['/identify', 'mail'], ['/mailbox/', 'mail'], ['/letters/', 'mail'],
]
export function moduleOf(url) {
  const p = url.split('?')[0]
  if (p === '/' || /\.[a-z0-9]+$/i.test(p)) return 'core'        // 静态文件
  for (const [prefix, m] of ROUTE_MODULE) if (p === prefix || p.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')) return m
  return 'pursuits'
}

export const isEnabled = (state, name) => name === 'core' || Boolean(state[name])
