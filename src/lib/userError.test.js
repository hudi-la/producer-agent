import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeError, safeErrorDetail } from './userError.js'
import { setLang } from '../i18n/index.js'

test('provider failures distinguish quota, rate limits, credentials, models and storage', () => {
  for (const [error, kind] of [['HTTP 429 insufficient_quota', 'quota'], ['HTTP 429 rate_limit', 'rate'], ['HTTP 401 invalid token', 'auth'], ['model not found', 'model'], ['HTTP 413', 'large'], ['EACCES', 'denied'], ['ENOSPC', 'disk'], ['Failed to fetch', 'network'], ['Request timed out', 'timeout'], ['HTTP 503', 'server'], ['invalid ZIP archive', 'backup']]) {
    assert.equal(describeError(error).kind, kind, error)
    assert.ok(describeError(error).action.length > 15)
  }
})
test('diagnostics remove credentials, OAuth queries, bridge passwords and auth headers', () => {
  const detail = safeErrorDetail('HTTP 401 https://user:bridge-password@example.com/mcp?token=secret#code=secret apiKey="secret-key" oauthToken=secret-token Bearer secret-bearer sk-ant-private AIzaPrivate eyJprivate.payload.signature')
  for (const secret of ['bridge-password', 'secret', 'sk-ant-private', 'AIzaPrivate', 'eyJprivate']) assert.ok(!detail.includes(secret), secret)
  assert.match(detail, /HTTP 401/)
  assert.match(detail, /example.com\/mcp/)
})
test('nested and unknown errors remain understandable in both languages', () => {
  setLang('zh'); assert.equal(describeError({ error: { message: 'HTTP 401' } }).kind, 'auth')
  assert.match(describeError('opaque').title, /没有完成/)
  setLang('en'); assert.equal(describeError('HTTP 401').title, 'Authorization failed')
  setLang('zh')
})
