// Run manually via SSH on a standby Render instance. No tenant credentials are
// created, no model is called, and every business mutation must be rejected.
// This checks the REAL server/imports, not the standby health adapter. An actual
// approved account still needs separate authenticated business acceptance.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = await mkdtemp(join(tmpdir(), 'fairwind-acceptance-'))
const port = 18789
const child = spawn(process.execPath, ['server.js'], {
  cwd: fileURLToPath(new URL('../brain', import.meta.url)),
  env: { ...process.env, FAIRWIND_MODE: 'hosted', FAIRWIND_ACCEPTANCE_READONLY: 'true',
    FAIRWIND_ACCEPTANCE_OWNER: '00000000-0000-0000-0000-000000000001',
    FAIRWIND_DATA_DIR: dir, BRAIN_HOST: '127.0.0.1', BRAIN_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
child.stdout.on('data', x => { logs += x }); child.stderr.on('data', x => { logs += x })
const results = []
try {
  let ready = false
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error('Acceptance backend exited before readiness')
    try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }); ready = r.status === 200 } catch {}
    if (ready) break
    await new Promise(r => setTimeout(r, 100))
  }
  assert.equal(ready, true, 'real backend reaches healthy state')
  for (const [method, path, expected, token] of [
    ['GET', '/health', 200], ['GET', '/me', 401], ['GET', '/settings', 401],
    ['GET', '/me', 401, 'invalid-migration-token'], ['GET', '/', 403],
    ['POST', '/chat', 403], ['POST', '/settings', 403], ['POST', '/calendar/sync', 403],
    ['POST', '/gmail/send', 403], ['POST', '/mcp', 403],
    ['GET', '/oauth/gmail/callback?code=not-a-real-code', 403],
  ]) {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method,
      headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(10000) })
    assert.equal(r.status, expected, `${method} ${path}`)
    await r.arrayBuffer()
    results.push({ method, path: path.split('?')[0], expected, actual: r.status })
  }
  // First automatic jobs normally start at 0/5/8 seconds. Wait past all three
  // and verify none were scheduled in this secondary migration-only process.
  await new Promise(r => setTimeout(r, 8500))
  assert.doesNotMatch(logs, /⏱|第一次收信|后台先读：|造卡任务：/)
  const pty = execFileSync('/usr/bin/expect', ['-c', 'spawn -noecho /bin/sh -c {printf PTY_OK}; expect PTY_OK; expect eof'], { encoding: 'utf8' })
  assert.match(pty, /PTY_OK/)
  console.log(JSON.stringify({ passed: true, node: process.version, checks: results, backgroundJobs: 'disabled', pty: 'passed', modelCalls: 0 }))
} catch (error) {
  // Runtime logs may contain tenant data; do not print them in shared outputs.
  console.error(JSON.stringify({ passed: false, error: error.message, childExit: child.exitCode }))
  process.exitCode = 1
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise(r => child.once('exit', r))
  }
}
