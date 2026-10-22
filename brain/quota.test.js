import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quotaOf, guessResetAt, QuotaError } from './quota.js'

const NOW = Date.parse('2026-10-07T10:00:00Z')

test('Claude 订阅:竖线后的 unix 秒就是重置时间', () => {
  const q = quotaOf('Claude AI usage limit reached|1759871234', NOW)
  assert.equal(q.kind, 'tokens'); assert.equal(q.topUp, false)
  assert.equal(q.resetAt, new Date(1759871234 * 1000).toISOString())
})

test('新版说法「resets 3pm」:读成下一个 15:00,原话留着', () => {
  const q = quotaOf(new Error('5-hour limit reached ∙ resets 3pm'), NOW)
  assert.equal(q.resetText, '3pm')
  assert.ok(q.resetAt)
  assert.equal(new Date(q.resetAt).getHours(), 15)
})

test('要充值的不会自己好', () => {
  assert.equal(quotaOf({ status: 429, message: 'You exceeded your current quota', body: { error: { code: 'insufficient_quota' } } }, NOW).topUp, true)
  assert.equal(quotaOf(new Error('Your credit balance is too low to access the Anthropic API'), NOW).topUp, true)
})

test('Gemini 429 带 retryDelay;没说多久就按一刻钟', () => {
  const g = quotaOf({ status: 429, message: 'RESOURCE_EXHAUSTED', body: '{"retryDelay": "37s"}' }, NOW)
  assert.equal(g.resetAt, new Date(NOW + 37_000).toISOString())
  const r = quotaOf({ status: 429, message: 'rate limited' }, NOW)
  assert.equal(r.resetAt, new Date(NOW + 15 * 60_000).toISOString()); assert.equal(r.guessed, true)
})

test('不是额度的事回 null;QuotaError 原样拿回', () => {
  assert.equal(quotaOf(new Error('JSON parse failed'), NOW), null)
  const info = { kind: 'tokens', topUp: false, message: 'x' }
  assert.equal(quotaOf(new QuotaError(info)), info)
  assert.equal(guessResetAt('whenever'), null)
})
