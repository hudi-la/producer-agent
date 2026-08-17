import { test } from 'node:test'
import assert from 'node:assert/strict'
import { patchFor, canEdit } from './entries.js'
import { EDITABLE, subInfo } from '../data/schema.js'

// ── 改的那一格，到底落到库里哪儿 ──────────────────────────────
//
// producer.works 上「媒介」是表上的一列，而「机构 / 学校 / 年份 / 地点」住在 meta 这个
// jsonb 里。这个区别没有任何道理可讲，是历史。所以它必须只活在一个地方，
// 不然改工作的机构会写进一个不存在的列，或者改作品的媒介写进 meta，
// 两种都是存了但看不见 —— 最坏的一种坏法。

test('作品的媒介是表上的列', () => {
  assert.deepEqual(patchFor('work', 'medium', '装置'), { medium: '装置' })
})

test('工作的机构住在 meta 里', () => {
  assert.deepEqual(patchFor('job', 'org', 'IBM'), { meta: { org: 'IBM' } })
})

test('展览的年份也在 meta 里 —— 别跟表上那个 year 列搞混', () => {
  assert.deepEqual(patchFor('credit', 'year', '2025'), { meta: { year: '2025' } })
})

test('空字符串是「清空」，要原样送过去', () => {
  // 跟 profile 那支不一样：那边空字符串 = 不动（名字清空没意义）。
  // 条目这边描述写错了想删掉是正常需求，所以空字符串必须能穿过去。
  assert.deepEqual(patchFor('work', 'medium', ''), { medium: '' })
})

test('不认识的字段当场拦下，不许悄悄写到别处去', () => {
  assert.throws(() => patchFor('work', 'org', 'x'), /work/)
  assert.throws(() => patchFor('没这种', 'org', 'x'))
})

// ── 显示什么就能改什么 ──────────────────────────────────────
//
// 这条是拦「以后加个 kind，改了显示忘了改编辑」——那种漏法不会报错，
// 只会让某一类条目悄悄变成只读，而且没人发现。

test('每个能改的字段，都是折叠行上看得见的那几条事实', () => {
  const sample = {
    work: { kind: 'work', medium: 'MEDIUM' },
    job: { kind: 'job', meta: { org: 'ORG', start: 'START', end: 'END', location: 'LOC' } },
    education: { kind: 'education', meta: { school: 'SCHOOL', year: 'YEAR', location: 'LOC' } },
    credit: { kind: 'credit', meta: { org: 'ORG', year: 'YEAR', location: 'LOC' } },
    statement: { kind: 'statement', meta: { scope: 'SCOPE' } },
  }
  for (const [kind, fields] of Object.entries(EDITABLE)) {
    const e = sample[kind]
    assert.ok(e, `EDITABLE 里有 ${kind}，但这个测试没给它样本 —— 补上`)
    const shown = subInfo(e).join(' · ')
    for (const f of fields) {
      const sentinel = f.col ? e[f.key] : e.meta[f.key]
      assert.ok(
        shown.includes(sentinel),
        `${kind} 的「${f.label}」能改，但折叠行上看不见它（subInfo 没带出来）`,
      )
    }
  }
})

// ── 没有 id 的条目改不了 ────────────────────────────────────

test('连不上库时渲染的种子数据没有 id，不能让人以为改得了', () => {
  assert.equal(canEdit({ id: 'a-uuid', title: 'x' }), true)
  assert.equal(canEdit({ title: '种子里的条目，没有 id' }), false)
  assert.equal(canEdit(null), false)
})
