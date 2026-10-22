// 模型分档的全部规矩就三条,每条都是给「打包给学员」铺的路:
//
//   1. 两个环境变量都没配 = 一个字都不改今天的行为(Hu Di 的订阅路径照旧)。
//      modelFor 返回 null,query 的 options 里就不出现 model 这个键,
//      SDK 用默认——跟今天逐字相同。
//   2. 配了哪档换哪档。学员的 .env 里写 BRAIN_MODEL_CHEAP=haiku,
//      判断和邮件小活就走便宜模型;聊天写信不受影响。
//   3. 空字符串、纯空白 = 没配。不然 .env 里留一行空的会把 model 传成 ''。
//
// 见 docs/specs/2026-08-24-workshop-edition-roadmap.md ①。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelFor, withModel, GOOD, CHEAP } from './models.js'

test('两档都没配 = null,options 里不出现 model 键(今天的行为)', () => {
  assert.equal(modelFor(GOOD, {}), null)
  assert.equal(modelFor(CHEAP, {}), null)
  const opts = withModel({ maxTurns: 1 }, CHEAP, {})
  assert.deepEqual(opts, { maxTurns: 1 })
  assert.ok(!('model' in opts))
})

test('配了哪档换哪档,互不越界', () => {
  const env = { BRAIN_MODEL: 'claude-sonnet-5', BRAIN_MODEL_CHEAP: 'haiku' }
  assert.equal(modelFor(GOOD, env), 'claude-sonnet-5')
  assert.equal(modelFor(CHEAP, env), 'haiku')
  assert.deepEqual(withModel({ maxTurns: 1 }, CHEAP, env), { maxTurns: 1, model: 'haiku' })
})

test('只配便宜档:好档照旧走默认', () => {
  const env = { BRAIN_MODEL_CHEAP: 'haiku' }
  assert.equal(modelFor(GOOD, env), null)
  assert.equal(modelFor(CHEAP, env), 'haiku')
})

test('空串和纯空白 = 没配', () => {
  assert.equal(modelFor(GOOD, { BRAIN_MODEL: '' }), null)
  assert.equal(modelFor(CHEAP, { BRAIN_MODEL_CHEAP: '   ' }), null)
})

test('withModel 不改原对象', () => {
  const base = { maxTurns: 2 }
  withModel(base, CHEAP, { BRAIN_MODEL_CHEAP: 'haiku' })
  assert.deepEqual(base, { maxTurns: 2 })
})
