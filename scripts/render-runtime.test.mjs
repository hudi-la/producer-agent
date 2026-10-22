import test from 'node:test'
import assert from 'node:assert/strict'
import { deploymentConfig, standbyServer } from './render-runtime.mjs'

const live = { FAIRWIND_DEPLOYMENT_STATE: 'live', FAIRWIND_CUTOVER_CONFIRMED: 'true',
  FAIRWIND_MODE: 'hosted', FAIRWIND_DATA_DIR: '/var/data/fairwind',
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'test-only',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only', GMAIL_CLIENT_ID: 'test-only', GMAIL_CLIENT_SECRET: 'test-only',
  BRAIN_ORIGIN: 'https://fairwind.example.com' }
test('default standby needs no credentials', () => assert.deepEqual(deploymentConfig({}), { state: 'standby', port: 10000 }))
test('Render PORT wins over old DO BRAIN_PORT', () => assert.equal(deploymentConfig({ ...live, PORT: '12345', BRAIN_PORT: '8788' }).port, 12345))
test('unknown mode and invalid port fail closed', () => {
  assert.throws(() => deploymentConfig({ FAIRWIND_DEPLOYMENT_STATE: 'on' }))
  for (const PORT of ['-1', '0', '1.5', '65536', 'abc']) assert.throws(() => deploymentConfig({ PORT }))
})
test('live needs explicit cutover, hosted mode, durable path and credentials', () => {
  assert.equal(deploymentConfig(live).state, 'live')
  for (const key of Object.keys(live).filter(k => k !== 'FAIRWIND_DEPLOYMENT_STATE')) {
    assert.throws(() => deploymentConfig({ ...live, [key]: '' }), key)
  }
  assert.throws(() => deploymentConfig({ ...live, FAIRWIND_DATA_DIR: 'temp' }))
  assert.throws(() => deploymentConfig({ ...live, BRAIN_ORIGIN: 'http://example.com' }))
})
test('standby serves health but blocks every business route, including GET callbacks', async () => {
  const server = standbyServer()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const health = await fetch(base + '/health')
    assert.equal(health.status, 200)
    assert.equal((await health.json()).businessReady, false)
    for (const [method, path] of [['GET', '/'], ['GET', '/me'], ['GET', '/oauth/gmail/callback?code=test'], ['POST', '/mcp'], ['POST', '/mail/send'], ['POST', '/chat'], ['POST', '/health']]) {
      const response = await fetch(base + path, { method })
      assert.equal(response.status, 503)
      assert.equal((await response.json()).deployment, 'standby')
    }
  } finally { await new Promise(r => server.close(r)) }
})
