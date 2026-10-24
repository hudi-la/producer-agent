// brain/modules.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadModules, setModules, moduleOf, isEnabled } from './modules.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'fw-modules-'))

test('云端模式:全开、不可切', () => {
  assert.deepEqual(loadModules({ dataDir: null, mode: 'service' }), { profile: true, pursuits: true, mail: true, canToggle: false })
  assert.throws(() => setModules({ dataDir: null, mode: 'user' }, { mail: false }), /云端/)
})

test('本机缺省只开档案层;写盘后能读回', () => {
  const dir = tmp()
  assert.deepEqual(loadModules({ dataDir: dir, mode: 'local' }), { profile: true, pursuits: false, mail: false, canToggle: true })
  setModules({ dataDir: dir, mode: 'local' }, { pursuits: true })
  assert.equal(loadModules({ dataDir: dir, mode: 'local' }).pursuits, true)
  rmSync(dir, { recursive: true, force: true })
})

test('开 mail 自动开 pursuits;关 pursuits 自动关 mail;profile 关不掉', () => {
  const dir = tmp()
  let s = setModules({ dataDir: dir, mode: 'local' }, { mail: true })
  assert.deepEqual([s.profile, s.pursuits, s.mail], [true, true, true])
  s = setModules({ dataDir: dir, mode: 'local' }, { pursuits: false })
  assert.deepEqual([s.profile, s.pursuits, s.mail], [true, false, false])
  s = setModules({ dataDir: dir, mode: 'local' }, { profile: false })
  assert.equal(s.profile, true)
  rmSync(dir, { recursive: true, force: true })
})

test('路由归属(2026-09-16 server.js 里的全部路由)', () => {
  for (const [u, m] of [
    ['/health', 'core'], ['/mcp', 'core'], ['/me', 'core'], ['/db/rpc/x', 'core'], ['/db/from', 'core'], ['/files/a%2Fb', 'core'], ['/modules', 'core'], ['/setup', 'core'], ['/', 'core'], ['/assets/index-abc.js', 'core'],
    ['/chat', 'profile'], ['/chat/stream', 'profile'], ['/chat/stop', 'profile'], ['/judgments/preview', 'profile'],
    ['/stage', 'pursuits'], ['/ball', 'pursuits'], ['/brief', 'pursuits'], ['/subjects/rejudge', 'pursuits'], ['/something-new', 'pursuits'],
    ['/mail/sync', 'mail'], ['/mail/adopt', 'mail'], ['/mail/send', 'mail'], ['/gmail-draft', 'mail'], ['/refresh', 'mail'], ['/identify', 'mail'], ['/mailbox/carry', 'mail'], ['/letters/triage', 'mail'],
  ]) assert.equal(moduleOf(u), m, u)
  assert.equal(isEnabled({ profile: true, pursuits: false, mail: false }, 'core'), true)
  assert.equal(isEnabled({ profile: true, pursuits: false, mail: false }, 'profile'), true)
  assert.equal(isEnabled({ profile: true, pursuits: false, mail: false }, 'pursuits'), false)
})
