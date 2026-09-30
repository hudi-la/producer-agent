import test from 'node:test'
import assert from 'node:assert/strict'
import {
  tail, fullPrompt, parseCards, pick, pickable, report3, brief, haltKind,
  checkPrompt, parseChecks, checkCapOf, reachCapOf, cardCapOf,
  CARDS_MARK, CHECKS_MARK, profileBlock } from './scout.js'

const ctx = {
  today: '2026-09-07',
  tz: 'America/Los_Angeles',
  existing: [{ title: 'MacDowell', org: 'MacDowell', url: 'https://www.macdowell.org/apply' }],
}

// ── 三个上限 ──────────────────────────────────────────────────
test('三个上限各管各的，配错了退回默认', () => {
  const t = { config: { check_per_round: 30, reach_per_round: 4, card_cap: 20 } }
  assert.equal(checkCapOf(t), 30)
  assert.equal(reachCapOf(t), 4)
  assert.equal(cardCapOf(t), 20)
  assert.equal(checkCapOf({ config: {} }), 20)
  assert.equal(reachCapOf({ config: { reach_per_round: 'x' } }), 8)
  assert.equal(cardCapOf({}), 12)
})

// ── 第一步 · 复查 ─────────────────────────────────────────────
test('复查的话里带 id、带表里记的日期、要求一条都不许少', () => {
  const p = checkPrompt([
    { id: 'a1', title: 'Pioneer Works 驻留', org: 'Pioneer Works', deadline: '2026年7月13日', deadline_at: '2026-07-13', url: null },
    { id: 'b2', title: 'Transmediale', opens_at: '2026-08-01' },
  ], ctx)
  assert.match(p, /id=a1/)
  assert.match(p, /id=b2/)
  assert.match(p, /2026-07-13/)
  assert.match(p, /一个都不许跳过/)
  assert.match(p, /一条都不能少/)
  assert.match(p, /自己搜官网/)      // 没链接的那条要说清楚
})

test('解析复查：坏日期变 null，认不出的状态退回 unknown', () => {
  const out = parseChecks(`查完了。
${CHECKS_MARK} {"checks":[{"id":"a1","status":"open","deadline":"July 13, 2027","deadline_at":"2027-07-13","note":"2027 轮已开"},{"id":"b2","status":"closed","deadline_at":"spring 2027","opens_at":"2026-10-01"},{"id":"c3","status":"???"}]}`)
  assert.equal(out.length, 3)
  assert.equal(out[0].status, 'open')
  assert.equal(out[0].deadline_at, '2027-07-13')
  assert.equal(out[1].deadline_at, null)
  assert.equal(out[1].opens_at, '2026-10-01')
  assert.equal(out[2].status, 'unknown')
})

test('复查没按格式说话 → null，不许当成「都没变」', () => {
  assert.equal(parseChecks('我查了一圈，没什么变化。'), null)
  assert.equal(parseChecks(`${CHECKS_MARK} {"checks":`), null)
})

// ── 第二步 · 找新的 ───────────────────────────────────────────
test('尾巴带今天、带表里已有的；落点是表所以不设条数上限', () => {
  const p = fullPrompt({ prompt: '你是 HuDi 的助理。' }, ctx)
  assert.ok(p.startsWith('你是 HuDi 的助理。'))
  assert.match(p, /2026-09-07/)
  assert.match(p, /MacDowell · MacDowell/)
  assert.match(p, /\[\[CARDS\]\]/)
  assert.match(p, /不设条数上限/)
  assert.ok(!/最多 5 个/.test(p))          // 老的那条上限撤了
  assert.match(p, /当前没开放的也报/)
  assert.match(p, /eligible=false 的（限美国公民 \/ 绿卡 \/ 需当地工作权）\*\*照报\*\*/)
})

test('解析信封：坏日期变 null、星级只认 2/3、eligible 默认 true、status 只认三档', () => {
  const text = `扫了 Colossal 和 TransArtists。
${CARDS_MARK} {"cards":[{"title":"Eyebeam 2027","org":"Eyebeam","deadline":"spring 2027","deadline_at":"spring 2027","match_stars":3,"status":"open","url":"https://eyebeam.org/apply/"},{"title":"Vanity Prize","match_stars":5,"eligible":false,"status":"什么"}],"skipped":[{"title":"Art Show Intl","why":"报名费 $80，奖项含糊"}]}`
  const out = parseCards(text)
  assert.equal(out.cards.length, 2)
  assert.equal(out.cards[0].deadline_at, null)
  assert.equal(out.cards[0].deadline, 'spring 2027')
  assert.equal(out.cards[0].status, 'open')
  assert.equal(out.cards[0].eligible, true)
  assert.equal(out.cards[1].match_stars, null)
  assert.equal(out.cards[1].eligible, false)
  assert.equal(out.cards[1].status, 'unknown')
  assert.equal(out.skipped[0].why, '报名费 $80，奖项含糊')
  assert.equal(out.said, '扫了 Colossal 和 TransArtists。')
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

test('去重：标题忽略大小写、链接忽略末尾斜杠、同一轮报两遍只算一次；默认不截断', () => {
  const cards = [
    { title: 'macdowell ', url: null, match_stars: 3 },
    { title: 'Something New', url: 'https://www.macdowell.org/apply/', match_stars: 2 },
    { title: 'Fresh One', url: 'https://a.org', match_stars: 2 },
    { title: 'fresh one', url: 'https://b.org', match_stars: 3 },
    { title: 'Another', url: 'https://c.org', match_stars: 3 },
  ]
  const { take, dup, over } = pick(cards, ctx.existing)
  assert.deepEqual(dup.map((c) => c.title), ['macdowell ', 'Something New', 'fresh one'])
  assert.deepEqual(take.map((c) => c.title), ['Another', 'Fresh One'])   // 星多的在前
  assert.deepEqual(over, [])                                            // 默认没有上限
})

// ── 第三步 · 挑 ───────────────────────────────────────────────
test('门槛不是名额：够格的全造，★★★ 遇上 longshot 才拦下', () => {
  const rows = [
    { title: '三星 · 够得着', fit_stars: 3, reach: 'realistic' },
    { title: '三星 · 有点悬', fit_stars: 3, reach: 'stretch' },
    { title: '三星 · 没查到', fit_stars: 3, reach: null },
    { title: '三星 · 多半白投', fit_stars: 3, reach: 'longshot' },
    { title: '二星 · 够得着', fit_stars: 2, reach: 'realistic' },
    { title: '二星 · 有点悬', fit_stars: 2, reach: 'stretch' },
    { title: '一星', fit_stars: 1, reach: 'realistic' },
  ]
  const { take, hold, over } = pickable(rows, 12)
  assert.deepEqual(take.map((r) => r.title),
    ['三星 · 够得着', '三星 · 没查到', '三星 · 有点悬', '二星 · 够得着'])
  assert.deepEqual(hold.map((r) => r.title), ['三星 · 多半白投', '二星 · 有点悬', '一星'])
  assert.deepEqual(over, [])
})

test('往届名单没查到 → 存疑不降级，★★★ 照造卡', () => {
  const { take } = pickable([{ title: 'X', fit_stars: 3, reach: 'unknown' }], 12)
  assert.equal(take.length, 1)
})

test('安全阀只防跑飞，被它拦下的要能报出来', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ title: 'O' + i, fit_stars: 3, reach: 'realistic' }))
  const { take, over } = pickable(rows, 3)
  assert.equal(take.length, 3)
  assert.equal(over.length, 2)
})

// ── 战报 ──────────────────────────────────────────────────────
test('战报三步各说一句；没轮到的、被安全阀拦下的、没到门槛的都得说出来', () => {
  const r = report3({
    today: '2026-09-07',
    checked: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
    opened: [{ title: 'Pioneer Works' }],
    closedNow: [{ title: 'Web Residency' }],
    leftToCheck: 47,
    found: [{ title: 'NOIS//E' }],
    dupFound: [{ title: 'MacDowell' }],
    skipped: [{ title: 'Art Show Intl', why: '报名费 $80' }],
    judged: [{ title: 'Pioneer Works', label: '够得着', why: '往届有刚出校门的' }],
    made: [{ title: 'Pioneer Works' }],
    overCap: [{ title: 'X' }],
    held: [{ title: 'Y' }],
    cardCap: 1,
  })
  assert.match(r, /复查 3 行：1 个开了（Pioneer Works），1 个关了，1 个没变；还有 47 行没轮到/)
  assert.match(r, /找到 1 个新的进表：NOIS\/\/E/)
  assert.match(r, /表里已有、跳过 1 个：MacDowell/)
  assert.match(r, /查了没收 1 个：Art Show Intl（报名费 \$80）/)
  assert.match(r, /判了 1 个够不够得着：Pioneer Works → 够得着（往届有刚出校门的）/)
  assert.match(r, /造了 1 张卡：Pioneer Works/)
  assert.match(r, /还有 1 个够格但这轮没造（一轮最多 1 张）：X/)
  assert.match(r, /开着但没到造卡门槛的 1 个.*：Y/)
})

test('什么都没发生的一轮也要说清楚，不许空着', () => {
  const r = report3({ today: '2026-09-07' })
  assert.match(r, /复查：这轮没有该查的行/)
  assert.match(r, /找新的：这轮没有新的/)
  assert.match(r, /这轮没有够格造卡的/)
})

test('{{画像}} 换成档案;没占位符的提示词一个字不动;档案空着明说', () => {
  const ctx = { today: '2026-09-17', tz: 'America/Los_Angeles', existing: [],
    profile: { name: 'A', website: 'a.com', data: { visa: 'O-1', location: ['LA', 'SF'], exclude_rule: '限公民' } }, concerns: ['被看见'], works: [{ title: '作品一', medium: '装置' }] }
  const out = fullPrompt({ prompt: '你是助理。\n\n== 画像 ==\n{{画像}}\n\n== 来源 ==\n- x' }, ctx)
  assert.match(out, /- 名字:A/); assert.match(out, /- 常住:LA \/ SF/); assert.match(out, /排除规则.*限公民/); assert.match(out, /『作品一』\(装置\)/)
  assert.ok(!out.includes('{{画像}}'))
  const same = fullPrompt({ prompt: '手写画像,没占位符' }, ctx); assert.ok(same.startsWith('手写画像,没占位符\n\n== 今天是'))
  assert.match(profileBlock({ profile: null }), /档案还没填/)
})

test('brief:模型接口回的整段 JSON 只留 message 一句,截到 160 字', () => {
  const raw = '模型接口回 404:[{\n  "error": {\n    "code": 404,\n    "message": "This model models/gemini-2.5-pro is no longer available to new users. Please update your code to use models/gemini-3.1-pro-preview for the latest features and improvements. We recommend you to use the Interactions API (https://ai.google.dev/gemini-api)."\n  }\n}]'
  const b = brief(raw)
  assert.match(b, /^模型接口回 404:This model models\/gemini-2\.5-pro is no longer available/)
  assert.ok(!b.includes('{') && !b.includes('"code"') && b.length <= 160, b)
  assert.equal(brief('没按格式报'), '没按格式报')
  const r = report3({ today: '2026-09-29', skipped: [{ title: '（找新的这一步）', why: raw }] })
  assert.ok(!r.includes('"error"') && r.includes('（找新的这一步）（模型接口回 404:This model'), r)
})

test('report3 按 FAIRWIND_LANG 写英文', () => {
  const was = process.env.FAIRWIND_LANG; process.env.FAIRWIND_LANG = 'en'
  try {
    const r = report3({ today: '2026-09-29', found: [{ title: 'Yaddo' }], made: [{ title: 'Yaddo' }] })
    assert.match(r, /Recheck: nothing due this round/); assert.match(r, /Found 1 new, added to the pool: Yaddo/); assert.match(r, /Made 1 card: Yaddo/)
    assert.ok(!/[\u4e00-\u9fff]/.test(r), '英文战报里不该有中文:' + r)
  } finally { if (was === undefined) delete process.env.FAIRWIND_LANG; else process.env.FAIRWIND_LANG = was }
})

test('停下来的那一句在最上面:没额度 / 型号下线 / 挤,各说各的;中英文', () => {
  const quota = '模型接口回 429:[{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details."}}]'
  assert.equal(haltKind(quota), 'quota'); assert.equal(haltKind('模型接口回 404:gone'), 'model'); assert.equal(haltKind('模型接口回 503:busy'), 'busy'); assert.equal(haltKind('boom'), 'error')
  const r = report3({ today: '2026-09-29', checked: [{ title: 'A' }], halts: [{ step: 'search', why: quota }, { step: 'judge', why: quota }] })
  const lines = r.split('\n')
  assert.match(lines[1], /^⚠️ 模型没额度了——这轮停在：找新的、判够不够得着。做完的部分留着。额度每天重置/)
  assert.match(lines[2], /^复查 1 行/, '复查的成果还在')
  const was = process.env.FAIRWIND_LANG; process.env.FAIRWIND_LANG = 'en'
  try { const e = report3({ today: '2026-09-29', halts: [{ step: 'search', why: '模型接口回 404:This model models/x is no longer available' }] }).split('\n')[1]; assert.match(e, /^⚠️ The model is no longer available — this run stopped at: search\./) }
  finally { if (was === undefined) delete process.env.FAIRWIND_LANG; else process.env.FAIRWIND_LANG = was }
})
