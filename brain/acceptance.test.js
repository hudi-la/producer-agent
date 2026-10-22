import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptanceConfig, acceptanceRequestAllowed } from './acceptance.js'
test('acceptance is opt-in and refuses public hosts or unspecified identities', () => {
  assert.deepEqual(acceptanceConfig({}), { enabled: false })
  const env = { FAIRWIND_ACCEPTANCE_READONLY: 'true', FAIRWIND_MODE: 'hosted', BRAIN_HOST: '127.0.0.1', FAIRWIND_ACCEPTANCE_OWNER: '00000000-0000-0000-0000-000000000001' }
  assert.equal(acceptanceConfig(env).enabled, true)
  for (const patch of [{ BRAIN_HOST: '0.0.0.0' }, { FAIRWIND_MODE: 'local' }, { FAIRWIND_ACCEPTANCE_OWNER: '' }]) assert.throws(() => acceptanceConfig({ ...env, ...patch }))
})
test('acceptance blocks mutations, callbacks, MCP and browser assets', () => {
  for (const path of ['/health', '/me', '/settings', '/modules', '/calendar/status', '/judgments/files']) {
    assert.equal(acceptanceRequestAllowed('GET', path), true)
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal(acceptanceRequestAllowed(method, path), false)
  }
  for (const path of ['/', '/index.html', '/mcp', '/oauth/gmail/callback', '/gmail/connect', '/chat', '/calendar/sync']) assert.equal(acceptanceRequestAllowed('GET', path), false)
})
