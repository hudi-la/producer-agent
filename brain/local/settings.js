// brain/local/settings.js —— <数据目录>/settings.json:本机那个人是谁、key、模型档位、备份目录。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const FILE = (dir) => join(dir, 'settings.json')
// 模型来源:claude-key(自己的 Anthropic key)| claude-subscription(Claude Code 的登录令牌,走订阅)
//         | openai(OPENAI key,走 OpenAI 兼容接口)| gemini(Gemini key,同一套接口)。engine/ 里有第二套循环。
export const PROVIDERS = ['claude-key', 'claude-subscription', 'openai', 'gemini', 'chatgpt-subscription']
const keyOf = (s) => s.provider === 'chatgpt-subscription' ? s.chatgptConnected === true : s.provider === 'claude-subscription' ? s.oauthToken : s.provider === 'openai' ? s.openaiKey : s.provider === 'gemini' ? s.geminiKey : s.apiKey
const withReady = (s) => { const p = PROVIDERS.includes(s.provider) ? s.provider : 'claude-key'; return { ...s, provider: p, ready: Boolean(s.email && keyOf({ ...s, provider: p })) } }

export function loadSettings(dataDir) {
  mkdirSync(dataDir, { recursive: true })
  if (!existsSync(FILE(dataDir))) {
    const fresh = { uid: randomUUID(), email: '', apiKey: '', model: '', modelCheap: '', backupDir: '', judgmentsEnabled: true, lang: 'zh', provider: 'claude-key', oauthToken: '', openaiKey: '', geminiKey: '' }
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
