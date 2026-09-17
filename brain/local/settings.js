// brain/local/settings.js —— <数据目录>/settings.json:本机那个人是谁、key、模型档位、备份目录。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const FILE = (dir) => join(dir, 'settings.json')
const withReady = (s) => ({ ...s, ready: Boolean(s.email && s.apiKey) })

export function loadSettings(dataDir) {
  mkdirSync(dataDir, { recursive: true })
  if (!existsSync(FILE(dataDir))) {
    const fresh = { uid: randomUUID(), email: '', apiKey: '', model: '', modelCheap: '', backupDir: '', judgmentsEnabled: true }
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
