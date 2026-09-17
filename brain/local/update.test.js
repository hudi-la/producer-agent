import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { checkUpdate, applyUpdate, currentVersionOf } from './update.js'

const tmp = (p) => mkdtempSync(join(tmpdir(), p))
// 造一个假发布物:Fairwind/VERSION 的 zip
function fakeZip(dir, version) {
  const src = join(dir, 'Fairwind'); mkdirSync(src, { recursive: true }); writeFileSync(join(src, 'VERSION'), version + '\n')
  const zip = join(dir, `Fairwind-${version}-mac-arm64.zip`)
  execFileSync('ditto', ['-c', '-k', '--keepParent', src, zip]); rmSync(src, { recursive: true })
  return { zip, sha256: createHash('sha256').update(readFileSync(zip)).digest('hex') }
}
const fakeFetch = (files) => async (url) => {
  const key = Object.keys(files).find((k) => url.endsWith(k))
  if (!key) return { ok: false, status: 404 }
  const v = files[key]
  return { ok: true, status: 200, json: async () => JSON.parse(v), arrayBuffer: async () => (Buffer.isBuffer(v) ? v : Buffer.from(v)) }
}

test('check:有新版本 → canUpdate;同版本 → 不;没这个平台 → 说原因;没配 → 说原因', async () => {
  const latest = JSON.stringify({ version: '0.2.0', note: '加了备份', platforms: { 'mac-arm64': { url: '/Fairwind-0.2.0-mac-arm64.zip', sha256: 'abc', size: 1 } } })
  const f = fakeFetch({ 'latest.json': latest })
  const a = await checkUpdate({ current: '0.1.0', latestUrl: 'http://x/r/latest.json', platform: 'mac-arm64', fetchImpl: f })
  assert.equal(a.canUpdate, true); assert.equal(a.latest, '0.2.0'); assert.equal(a.url, 'http://x/r/Fairwind-0.2.0-mac-arm64.zip')
  const b = await checkUpdate({ current: '0.2.0', latestUrl: 'http://x/r/latest.json', platform: 'mac-arm64', fetchImpl: f })
  assert.equal(b.canUpdate, false)
  const c = await checkUpdate({ current: '0.1.0', latestUrl: 'http://x/r/latest.json', platform: 'win-x64', fetchImpl: f })
  assert.equal(c.canUpdate, false); assert.match(c.error, /win-x64/)
  const d = await checkUpdate({ current: '0.1.0', latestUrl: '' }); assert.match(d.error, /发布位/)
  const e = await checkUpdate({ current: '0.1.0', latestUrl: 'http://x/r/latest.json', fetchImpl: async () => { throw new Error('offline') } })
  assert.equal(e.canUpdate, false); assert.match(e.error, /offline/)
})

test('apply:下载、校验、解压、换指针;旧版还在;校验不对不动指针', async () => {
  const root = tmp('fw-app-'), rel = tmp('fw-rel-')
  mkdirSync(join(root, 'app-0.1.0')); writeFileSync(join(root, 'app-0.1.0', 'VERSION'), '0.1.0\n'); symlinkSync('app-0.1.0', join(root, 'current'))
  const { zip, sha256 } = fakeZip(rel, '0.2.0')
  const f = fakeFetch({ 'Fairwind-0.2.0-mac-arm64.zip': readFileSync(zip) })
  await assert.rejects(() => applyUpdate({ appRoot: root, version: '0.2.0', url: 'http://x/Fairwind-0.2.0-mac-arm64.zip', sha256: 'deadbeef', fetchImpl: f }), /校验/)
  assert.equal(currentVersionOf(root), '0.1.0', '校验不对,指针没动')
  const r = await applyUpdate({ appRoot: root, version: '0.2.0', url: 'http://x/Fairwind-0.2.0-mac-arm64.zip', sha256, fetchImpl: f })
  assert.equal(r.previous, 'app-0.1.0'); assert.equal(currentVersionOf(root), '0.2.0')
  assert.ok(existsSync(join(root, 'app-0.1.0', 'VERSION')), '旧版还在'); assert.equal(existsSync(join(root, 'app-0.2.0.zip')), false, 'zip 用完删')
  rmSync(root, { recursive: true, force: true }); rmSync(rel, { recursive: true, force: true })
})
