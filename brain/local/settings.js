// brain/local/settings.js —— <数据目录>/settings.json:本机那个人是谁、key、模型档位、备份目录。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const FILE = (dir) => join(dir, 'settings.json')
// 模型来源:claude-key(自己的 API key)| claude-subscription(Claude Code 的登录令牌,走订阅)。
// GPT / Gemini 这套程序跑不了(brain 是 Claude Agent SDK),界面上灰着写明,这里不认。
const withReady = (s) => ({ ...s, provider: s.provider === 'claude-subscription' ? 'claude-subscription' : 'claude-key',
  ready: Boolean(s.email && (s.provider === 'claude-subscription' ? s.oauthToken : s.apiKey)) })

export function loadSettings(dataDir) {
  mkdirSync(dataDir, { recursive: true })
  if (!existsSync(FILE(dataDir))) {
    const fresh = { uid: randomUUID(), email: '', apiKey: '', model: '', modelCheap: '', backupDir: '', judgmentsEnabled: true, lang: 'zh', provider: 'claude-key', oauthToken: '' }
    writeFileSync(FILE(dataDir), JSON.stringify(fresh, null, 2))
    return withReady(fresh)
  }
  return withReady(JSON.parse(readFileSync(FILE(dataDir), 'utf8')))
}

export function saveSettings(dataDir, patch) {
  const cur = loadSettings(dataDir)
  const { ready, ...rest } = { ...cur, ...patch }   // ready 是算出来的,不落盘
  writeFileSync(FILE(dataDir), JSON.stringify(rest, null, 2))
  return withReady(rest)
}
