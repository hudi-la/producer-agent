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

// 填错栏的 key:认得出是别家的就拦下。浏览器会把存过的「密码」自动填进别的密码框——
// 10/1 Gemini 的 AIza… 就这么进了 Claude 订阅那栏,找机会跑到一半 401。认不出的格式照收(代理、新格式)。
const KIND = (v) => /^sk-ant-oat/.test(v) ? 'claude-subscription' : /^sk-ant-/.test(v) ? 'claude-key' : /^AIza/.test(v) ? 'gemini' : /^sk-/.test(v) ? 'openai' : null
const FIELD_OF = { apiKey: 'claude-key', oauthToken: 'claude-subscription', openaiKey: 'openai', geminiKey: 'gemini' }
const NAME = { 'claude-key': ['Claude API key', 'Claude API key'], 'claude-subscription': ['Claude 订阅令牌', 'Claude subscription token'], openai: ['OpenAI key', 'OpenAI key'], gemini: ['Gemini key', 'Gemini key'] }
export function wrongKey(patch) {
  for (const [k, want] of Object.entries(FIELD_OF)) {
    const got = typeof patch[k] === 'string' ? KIND(patch[k].trim()) : null
    if (got && got !== want) return `${NAME[want][0]}那栏里填的是 ${NAME[got][0]}(可能是浏览器自动填的),没存。清空那栏重新粘 / The ${NAME[want][1]} field holds a ${NAME[got][1]} (maybe browser autofill) — not saved. Clear it and paste again`
  }
  return null
}
