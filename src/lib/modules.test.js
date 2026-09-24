import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowedAreas, fetchModules } from './modules.js'

test('机会线关着只剩我的档案;开着五个都在', () => {
  assert.deepEqual(allowedAreas({ profile: true, pursuits: false, mail: false }), ['profile', 'settings'])
  assert.deepEqual(allowedAreas({ profile: true, pursuits: true, mail: false }), ['desk', 'pursue', 'people', 'ledger', 'profile', 'settings'])
})

test('brain 没醒:按全开画,不可切', async () => {
  const m = await fetchModules(async () => { throw new Error('ECONNREFUSED') })
  assert.deepEqual(m, { profile: true, pursuits: true, mail: true, canToggle: false })
  const m2 = await fetchModules(async () => ({ ok: false }))
  assert.equal(m2.canToggle, false)
})
