import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelDefaults, modelOverride, modelChoices, modelFamily } from './modelDefaults.js'
import { providerConfig } from '../../brain/engine/index.js'

test('displayed defaults match the actual API engine for both tiers', () => {
  for (const provider of ['openai', 'gemini']) {
    const env = { FAIRWIND_PROVIDER: provider, OPENAI_API_KEY: 'test', GEMINI_API_KEY: 'test' }
    for (const [field, tier] of [['model', 'good'], ['modelCheap', 'cheap']]) {
      assert.equal(modelDefaults(provider)[field], providerConfig(tier, env).model)
      assert.equal(modelOverride(modelDefaults(provider)[field], provider, field), '')
    }
  }
})

test('SDK and Codex labels stay out of saved model overrides; custom IDs survive', () => {
  for (const provider of ['claude-key', 'claude-subscription', 'chatgpt-subscription']) {
    for (const field of ['model', 'modelCheap']) {
      assert.equal(modelOverride(modelDefaults(provider)[field], provider, field), '')
      assert.equal(modelOverride('  custom-model  ', provider, field), 'custom-model')
      assert.equal(modelOverride('   ', provider, field), '')
    }
  }
})

test('choices include defaults, preserve saved models, and stay within the selected provider', () => {
  for (const provider of ['claude-key', 'claude-subscription', 'openai', 'gemini', 'chatgpt-subscription']) {
    for (const field of ['model', 'modelCheap']) {
      const choices = modelChoices(provider, field)
      assert.equal(choices[0], modelDefaults(provider)[field])
      assert.equal(new Set(choices).size, choices.length)
      assert.ok(modelChoices(provider, field, 'saved-model').includes('saved-model'))
    }
  }
  assert.deepEqual(modelChoices('claude-key', 'model'), ['SDK', 'sonnet', 'haiku', 'opus'])
  assert.ok(modelChoices('openai', 'model').every(m => m.startsWith('gpt-')))
  assert.ok(modelChoices('gemini', 'model').every(m => m.startsWith('gemini-')))
  assert.equal(modelFamily('claude-key'), modelFamily('claude-subscription'))
  assert.notEqual(modelFamily('openai'), modelFamily('gemini'))
})
