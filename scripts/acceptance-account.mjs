// Operator-only migration acceptance. Run on the standby candidate, never via
// HTTP. Uses one explicitly approved existing account; no mail/calendar writes,
// no new user, no business-row mutations, no secret or user-content logging.
// Usage: node scripts/acceptance-account.mjs DISPLAY_NAME SNAPSHOT_ROOT [--model]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(new URL('../brain/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const { google } = require('googleapis')
const { makeHosted, withTenant, childEnv } = await import('../brain/tenant.js')
const [name, root] = process.argv.slice(2)
assert.ok(name && root?.startsWith('/var/data/fairwind/acceptance-'))
assert.equal(process.env.FAIRWIND_DEPLOYMENT_STATE, 'standby')
const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } })
const matches = []
for (let page = 1; page <= 20; page++) {
  const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 })
  assert.ok(!error, 'Auth user lookup succeeds')
  matches.push(...data.users.filter(u => (u.user_metadata?.full_name || u.user_metadata?.name) === name))
  if (data.users.length < 200) break
}
assert.equal(matches.length, 1, 'Approved display name must resolve to exactly one existing identity')
const owner = matches[0].id
const hosted = makeHosted({ url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY,
  service, createClient, dataRoot: root })
let child
const checks = []
const pass = (check, detail = {}) => { const row = { check, passed: true, ...detail }; checks.push(row); console.log(JSON.stringify(row)) }
try {
  const t = await hosted.forOwner(owner)
  pass('existing account authenticated using tenant-scoped client')
  for (const view of ['v_pa_profile', 'v_pa_pursuits', 'v_pa_contacts', 'v_pa_entries']) {
    const { count, error } = await t.db.from(view).select('*', { count: 'exact', head: true })
    assert.ok(!error, `${view} tenant read succeeds`)
    pass(view, { count })
  }
  const { data: session } = await t.db.auth.getSession()
  const port = 18789
  child = spawn(process.execPath, ['server.js'], {
    cwd: fileURLToPath(new URL('../brain', import.meta.url)),
    env: { ...process.env, FAIRWIND_MODE: 'hosted', FAIRWIND_ACCEPTANCE_READONLY: 'true',
      FAIRWIND_ACCEPTANCE_OWNER: owner, FAIRWIND_DATA_DIR: root, BRAIN_HOST: '127.0.0.1', BRAIN_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout.on('data', b => { logs += b }); child.stderr.on('data', b => { logs += b })
  let ready = false
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) break
    try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok } catch {}
    if (ready) break
    await new Promise(r => setTimeout(r, 100))
  }
  assert.ok(ready, 'Real candidate backend starts')
  for (const route of ['/me', '/settings', '/modules', '/calendar/status', '/judgments/files']) {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { Authorization: `Bearer ${session.session.access_token}` }, signal: AbortSignal.timeout(20000) })
    assert.equal(r.status, 200, route)
    const body = await r.json()
    if (route === '/me') assert.equal(body.user.id, owner)
    pass('authenticated GET ' + route)
  }
  if (t.settings.gmailRefreshToken) {
    const auth = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET)
    auth.setCredentials({ refresh_token: t.settings.gmailRefreshToken })
    const gmail = google.gmail({ version: 'v1', auth })
    const { data } = await gmail.users.getProfile({ userId: 'me' })
    assert.ok(data.emailAddress && data.emailAddress.toLowerCase() === t.settings.gmailAddress.toLowerCase(), 'Gmail belongs to approved tenant')
    await gmail.users.messages.list({ userId: 'me', maxResults: 1 })
    pass('Gmail refresh, profile and read-only message listing')
  } else throw new Error('Approved account has no Gmail connection to validate')
  const calendar = JSON.parse(await readFile(join(root, 'users', owner, 'calendar.json'), 'utf8'))
  if (calendar.refreshToken) {
    const auth = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET)
    auth.setCredentials({ refresh_token: calendar.refreshToken })
    await google.calendar({ version: 'v3', auth }).calendarList.list({ maxResults: 1 })
    pass('Calendar authorization survives state transfer; read-only list')
  } else throw new Error('Approved account has no completed Calendar connection to validate')
  if (process.argv.includes('--model')) {
    assert.ok(['claude-key', 'claude-subscription'].includes(t.settings.provider), 'Budgeted probe supports configured Claude provider only')
    const { query } = require('@anthropic-ai/claude-agent-sdk')
    const cwd = await mkdtemp(join(tmpdir(), 'fairwind-model-probe-'))
    let result
    await withTenant(t, async () => {
      for await (const m of query({ prompt: 'Reply with exactly MIGRATION_OK. Do not call tools.', options: {
        cwd, env: childEnv(), tools: [], allowedTools: [], mcpServers: {}, settingSources: [],
        permissionMode: 'default', canUseTool: async () => ({ behavior: 'deny', message: 'Migration probe forbids tools' }),
        persistSession: false, maxTurns: 1, maxBudgetUsd: 0.50,
        abortController: new AbortController(),
        ...(t.settings.modelCheap ? { model: t.settings.modelCheap } : {}),
      } })) if (m.type === 'result') result = m
    })
    assert.equal(result?.subtype, 'success', 'Model returns success')
    assert.match(result.result, /MIGRATION_OK/)
    assert.ok(result.total_cost_usd <= 0.50, 'Probe stays within half of approved $1 budget')
    pass('real tenant Claude SDK subprocess', { costUsd: result.total_cost_usd })
  }
  await new Promise(r => setTimeout(r, 8500))
  assert.doesNotMatch(logs, /⏱|第一次收信|后台先读：|造卡任务：/)
  pass('secondary backend scheduled workers remain disabled')
  console.log(JSON.stringify({ passed: true, checks: checks.length, mutations: 0 }))
} catch (e) {
  console.error(JSON.stringify({ passed: false, error: e.name, check: e.code || 'acceptance_failed', message: e instanceof assert.AssertionError ? e.message : 'External probe failed; inspect privately; no credential/body logging' }))
  process.exitCode = 1
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)) }
  for (const { db } of hosted._caches.sessionCache.values()) { await db.auth.signOut({ scope: 'local' }); db.auth.stopAutoRefresh() }
}
