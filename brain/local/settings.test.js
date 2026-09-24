// brain/local/settings.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings } from './settings.js'

test('没文件:生成 uid、ready=false、写盘', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-settings-'))
  const s = loadSettings(dir)
  assert.match(s.uid, /^[0-9a-f-]{36}$/); assert.equal(s.ready, false)
  assert.equal(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).uid, s.uid)
  rmSync(dir, { recursive: true, force: true })
})

test('save 合并、ready 由 email+apiKey 决定、uid 不变', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-settings-'))
  const a = loadSettings(dir)
  const b = saveSettings(dir, { email: 'a@b.c' })
  assert.equal(b.ready, false)
  const c = saveSettings(dir, { apiKey: 'sk-ant-x' })
  assert.equal(c.ready, true); assert.equal(c.uid, a.uid); assert.equal(c.email, 'a@b.c')
  rmSync(dir, { recursive: true, force: true })
})

test('模型来源:订阅路 ready 看令牌不看 key;不认的来源退回 claude-key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-settings-'))
  let s = saveSettings(dir, { email: 'a@b.c', provider: 'claude-subscription' })
  assert.equal(s.ready, false)
  s = saveSettings(dir, { oauthToken: 'sk-ant-oat01-xxx' }); assert.equal(s.ready, true)
  s = saveSettings(dir, { provider: 'gpt' }); assert.equal(s.provider, 'claude-key'); assert.equal(s.ready, false)
  rmSync(dir, { recursive: true, force: true })
})
