import test from 'node:test'
import assert from 'node:assert/strict'
import { reachPrompt, reachSystem, parseReach, needsReach, REACH_LABEL, REACH_MARK } from './reach.js'

const opp = {
  title: 'Pioneer Works 驻留',
  org: 'Pioneer Works',
  kind: '驻地',
  location: 'Brooklyn',
  deadline: 'July 13, 2027',
  url: 'https://pioneerworks.org/residencies',
  why: '重过程与公共性，跟他参与式的做法对味',
}

test('问的话里点名要去翻往届名单、要举出人名', () => {
  const p = reachPrompt(opp)
  assert.match(p, /Pioneer Works 驻留/)
  assert.match(p, /往届名单/)
  assert.match(p, /past fellows|alumni|历届/)
  assert.match(p, /至少两个人|两三个人/)
  assert.match(p, /\[\[REACH\]\]/)
})

test('判据和履历进静态块，好让一轮里判好几个机会时吃缓存', () => {
  const sys = reachSystem({ name: 'Hu Di', data: { visa: 'O-1' } }, [
    { kind: 'credit', title: 'REEF 个展', year: 2026 },
  ])
  assert.equal(sys.length, 3)                       // [静态, 分界, 动态]
  assert.match(sys[0], /Hu Di/)
  assert.match(sys[0], /够不够得着/)
  assert.match(sys[0], /往届名单里有履历跟他相当的人/)
  assert.match(sys[0], /绝对不许编一份名单出来/)
  assert.match(sys[0], /REEF 个展/)                  // 履历真的进去了
})

test('解析：四档之外的退回 unknown', () => {
  const out = parseReach(`查了它的 past residents 页面。
${REACH_MARK} {"reach":"realistic","why":"往届里有刚出校门的","evidence":"2024 年的 Jane Doe，当年只有两个群展；2023 年的 Li Wei，MFA 刚毕业","url":"https://pioneerworks.org/past"}`)
  assert.equal(out.reach, 'realistic')
  assert.equal(out.url, 'https://pioneerworks.org/past')
  assert.match(out.evidence, /Jane Doe/)

  assert.equal(parseReach(`${REACH_MARK} {"reach":"很难说","evidence":"某某"}`).reach, 'unknown')
})

test('没凭证的判断不算数 —— 说得再笃定也退回 unknown', () => {
  const out = parseReach(`${REACH_MARK} {"reach":"longshot","why":"看起来很难","evidence":""}`)
  assert.equal(out.reach, 'unknown')
  assert.equal(out.downgraded, true)
})

test('查不到就答 unknown，那是正当答案不是失败', () => {
  const out = parseReach(`${REACH_MARK} {"reach":"unknown","why":"官网没有往届名单页，搜了新闻稿也没有","evidence":"找过 pioneerworks.org/past、Google 搜 site: 都没有名单"}`)
  assert.equal(out.reach, 'unknown')
  assert.equal(out.downgraded, false)
})

test('假链接不收', () => {
  assert.equal(parseReach(`${REACH_MARK} {"reach":"stretch","evidence":"x","url":"没有"}`).url, null)
})

test('没按格式说话 → null，不许当成一个判断', () => {
  assert.equal(parseReach('我觉得挺难的。'), null)
  assert.equal(parseReach(`${REACH_MARK} {"reach":`), null)
})

test('判过一次就够，300 天后才重判', () => {
  const now = new Date('2026-09-07T00:00:00Z').getTime()
  assert.equal(needsReach({ reach: null }, { now }), true)
  assert.equal(needsReach({ reach: 'realistic', reach_at: null }, { now }), true)
  assert.equal(needsReach({ reach: 'realistic', reach_at: '2026-08-01T00:00:00Z' }, { now }), false)
  assert.equal(needsReach({ reach: 'realistic', reach_at: '2025-08-01T00:00:00Z' }, { now }), true)
})

test('四档都有人话说法', () => {
  assert.equal(REACH_LABEL.realistic, '够得着')
  assert.equal(REACH_LABEL.unknown, '往届名单没查到')
})
