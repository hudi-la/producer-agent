import test from 'node:test'
import assert from 'node:assert/strict'
import { tail, fullPrompt, parseCards, pick, report, capOf, CARDS_MARK } from './scout.js'

const ctx = { today: '2026-09-07', tz: 'America/Los_Angeles', existing: [{ title: 'MacDowell', org: 'MacDowell', url: 'https://www.macdowell.org/apply' }] }

test('尾巴带今天、带库里已有的、带报法；任务那段在前', () => {
  const p = fullPrompt({ prompt: '你是 HuDi 的助理。' }, ctx)
  assert.ok(p.startsWith('你是 HuDi 的助理。'))
  assert.match(p, /2026-09-07/)
  assert.match(p, /MacDowell · MacDowell/)
  assert.match(p, /\[\[CARDS\]\]/)
  assert.match(p, /最多 5 条/)
})

test('上限看 config.max_new，没填或填坏了就是 5', () => {
  assert.equal(capOf({ config: { max_new: 3 } }), 3)
  assert.equal(capOf({ config: {} }), 5)
  assert.equal(capOf({ config: { max_new: 'x' } }), 5)
  assert.match(tail({ ...ctx, cap: 3 }), /最多 3 条/)
})

test('解析信封：坏日期变 null、星级只认 2/3、eligible 默认 true、前面的话留着', () => {
  const text = `扫了 Colossal 和 TransArtists，看到两条。
${CARDS_MARK} {"cards":[{"title":"Eyebeam 2027","org":"Eyebeam","deadline":"spring 2027","deadline_at":"spring 2027","match_stars":3,"url":"https://eyebeam.org/apply/"},{"title":"Vanity Prize","match_stars":5,"eligible":false}],"skipped":[{"title":"Art Show Intl","why":"报名费 $80，奖项含糊"}]}`
  const out = parseCards(text)
  assert.equal(out.cards.length, 2)
  assert.equal(out.cards[0].deadline_at, null)
  assert.equal(out.cards[0].deadline, 'spring 2027')
  assert.equal(out.cards[0].eligible, true)
  assert.equal(out.cards[1].match_stars, null)
  assert.equal(out.cards[1].eligible, false)
  assert.equal(out.skipped[0].why, '报名费 $80，奖项含糊')
  assert.equal(out.said, '扫了 Colossal 和 TransArtists，看到两条。')
})

test('没信封、坏 JSON、cards 不是数组 → null（不能当成「没找到」）', () => {
  assert.equal(parseCards('这周什么都没有。'), null)
  assert.equal(parseCards(`${CARDS_MARK} {"cards": [`), null)
  assert.equal(parseCards(`${CARDS_MARK} {"cards": "none"}`), null)
})

test('空信封是合法的：两个空数组', () => {
  const out = parseCards(`没合适的。\n${CARDS_MARK} {"cards":[],"skipped":[]}`)
  assert.deepEqual(out.cards, [])
  assert.deepEqual(out.skipped, [])
})

test('去重：标题忽略大小写、链接忽略末尾斜杠、同一轮里报两遍只算一次', () => {
  const cards = [
    { title: 'macdowell ', url: null, match_stars: 3 },
    { title: 'Something New', url: 'https://www.macdowell.org/apply/', match_stars: 2 },
    { title: 'Fresh One', url: 'https://a.org', match_stars: 2 },
    { title: 'fresh one', url: 'https://b.org', match_stars: 3 },
  ]
  const { take, dup } = pick(cards, ctx.existing, 5)
  assert.deepEqual(dup.map((c) => c.title), ['macdowell ', 'Something New', 'fresh one'])
  assert.deepEqual(take.map((c) => c.title), ['Fresh One'])
})

test('截断：星多的先建，超过上限的记在 over', () => {
  const cards = [
    { title: 'A', match_stars: 2 }, { title: 'B', match_stars: 3 },
    { title: 'C', match_stars: 3 }, { title: 'D', match_stars: null },
  ]
  const { take, over } = pick(cards, [], 2)
  assert.deepEqual(take.map((c) => c.title), ['B', 'C'])
  assert.deepEqual(over.map((c) => c.title), ['A', 'D'])
})

test('战报：新增、跳过、查了没建卡、超上限，各说各的；没新增也要说', () => {
  const r = report({
    today: '2026-09-07',
    made: [{ title: 'B' }, { title: 'C' }],
    dup: [{ title: 'MacDowell' }],
    skipped: [{ title: 'Art Show Intl', why: '报名费 $80' }],
    over: [{ title: 'A' }],
    cap: 2,
  })
  assert.match(r, /2026-09-07 新增 2 张：B · C/)
  assert.match(r, /跳过 1 张：MacDowell/)
  assert.match(r, /查了没建卡 1 个：Art Show Intl（报名费 \$80）/)
  assert.match(r, /超过一轮上限 2 张没建的 1 个：A/)
  assert.match(report({ today: '2026-09-07' }), /没有新增合适机会/)
})
