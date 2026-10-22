// 英文版的输出语言跟着当前这个人走(2026-10-08):线上每人的语言在租户 env 里,不在进程 env 里
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LANG_RULE, outputLang } from './prompt.js'
import { withTenant } from './tenant.js'

test('LANG_RULE 读当前租户的语言:英文租户带规矩,中文租户 / 没租户什么都不加', async () => {
  const en = { mode: 'hosted', env: { FAIRWIND_LANG: 'en' }, marks: {} }
  const zh = { mode: 'hosted', env: { FAIRWIND_LANG: 'zh' }, marks: {} }
  await withTenant(en, async () => { assert.equal(outputLang(), 'en'); assert.match(LANG_RULE(), /must be in English/) })
  await withTenant(zh, async () => { assert.equal(outputLang(), 'zh'); assert.equal(LANG_RULE(), '') })
})
