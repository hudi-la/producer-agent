import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engineOf, providerConfig } from './index.js'

test('没设 = claude;openai / gemini 认;别的退回 claude', () => {
  assert.equal(engineOf({}), 'claude'); assert.equal(engineOf({ FAIRWIND_PROVIDER: 'gemini' }), 'gemini'); assert.equal(engineOf({ FAIRWIND_PROVIDER: 'gpt' }), 'claude')
})

test('providerConfig:按档给模型,没配用默认;没 key 说清;base url 可覆盖', () => {
  assert.equal(providerConfig('good', { FAIRWIND_PROVIDER: 'claude' }), null)
  const g = providerConfig('good', { FAIRWIND_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })
  assert.equal(g.model, 'gpt-5'); assert.equal(g.baseURL, 'https://api.openai.com/v1')
  const c = providerConfig('cheap', { FAIRWIND_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', BRAIN_MODEL_CHEAP: 'gemini-x' })
  assert.equal(c.model, 'gemini-x'); assert.match(c.baseURL, /generativelanguage/)
  assert.throws(() => providerConfig('good', { FAIRWIND_PROVIDER: 'openai' }), /API key/)
  assert.equal(providerConfig('good', { FAIRWIND_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'http://proxy/v1' }).baseURL, 'http://proxy/v1')
})
