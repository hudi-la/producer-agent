// scout 的骨架/血肉分家(2026-08-25,④)。
//
// 单人版的 scout 是一份 markdown:Hu Di 的画像、他的项目 ID、写死的 SQL,
// 由他个人的定时任务执行。多租户的推导(A 卷)说:骨架(扫描流程、合法性
// 检查、去重、上限、输出协议)进代码;血肉(画像、方向、信息源)从**这个
// 学员自己的档案**现读。
//
// 这里钉两条性质:
//   1. prompt 里的画像来自传入的 profile——换个学员,画像跟着换
//   2. prompt 里**没有任何 Hu Di 的血肉**:没有他的签证、他的母题、
//      他的项目 ID,也没有 SQL(写库走 RPC,不走模型手写 SQL)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildScoutPrompt, parseCards, DEFAULT_SOURCES, SCOUT_SYSTEM } from './scout.js'

const 学员 = {
  name: 'Mira Test',
  website: 'https://mira.test/',
  data: {
    visa: '加拿大公民,无美国工作权',
    location: ['Toronto'],
    career_stage: 'mid-career',
    funding_pref: '只要带钱的',
    exclude_rule: '要交报名费的一律不看',
    watch_rule: '双年展哪怕没开放也留着',
  },
}

const 素材 = {
  profile: 学员,
  concerns: ['纤维与身体'],
  worksDigest: '『线的重量』(纤维装置)·『皮肤备忘录』(行为)',
  sources: ['https://example.org/calls'],
  existingTitles: ['已有的那条线'],
  cap: 5,
}

test('画像来自这个学员:他的规则一条不少', () => {
  const p = buildScoutPrompt(素材)
  for (const 必须有 of ['Mira Test', '加拿大公民', 'Toronto', '只要带钱的',
                        '要交报名费的一律不看', '双年展哪怕没开放也留着',
                        '纤维与身体', '线的重量', 'https://example.org/calls',
                        '已有的那条线', '[[CARDS]]']) {
    assert.ok(p.includes(必须有), `prompt 里少了:${必须有}`)
  }
})

test('没有任何 Hu Di 的血肉,也没有 SQL', () => {
  const p = buildScoutPrompt(素材) + SCOUT_SYSTEM
  for (const 不许有 of ['HuDi', 'Hu Di', 'hudi', 'O-1', '微缩', '装置为主',
                        'jjgvvtrsnoqnoigukobi', 'insert into', 'producer.',
                        'supabase', 'Supabase']) {
    assert.ok(!p.includes(不许有), `prompt 里混进了单人版血肉:${不许有}`)
  }
})

test('档案没填规则也能跑:空格子不渲染成 undefined', () => {
  const p = buildScoutPrompt({ ...素材, profile: { name: null, data: {} }, concerns: [], worksDigest: '', existingTitles: [] })
  assert.ok(!p.includes('undefined'))
  assert.ok(!p.includes('null'))
  assert.ok(p.includes('[[CARDS]]'))
})

test('sources 空着用产品默认的那几个聚合站', () => {
  const p = buildScoutPrompt({ ...素材, sources: [] })
  for (const s of DEFAULT_SOURCES) assert.ok(p.includes(s))
})

test('parseCards:认最后一行 [[CARDS]],坏 JSON 给空,不炸', () => {
  const good = '这周看了一圈。\n[[CARDS]] {"cards":[{"title":"某驻地","kind":"驻地","match_stars":3,"eligible":true}]}'
  const cards = parseCards(good)
  assert.equal(cards.length, 1)
  assert.equal(cards[0].title, '某驻地')
  assert.deepEqual(parseCards('没有标记'), [])
  assert.deepEqual(parseCards('[[CARDS]] {坏掉的'), [])
  assert.deepEqual(parseCards('[[CARDS]] {"cards": "不是数组"}'), [])
  // 没 title 的丢掉
  assert.deepEqual(parseCards('[[CARDS]] {"cards":[{"kind":"驻地"}]}'), [])
})
