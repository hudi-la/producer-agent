import test from 'node:test'
import assert from 'node:assert/strict'
import { extractLetter } from './letter.js'

test('摘出信封，正文里不留标记', () => {
  const raw = '亲爱的 Ana：\n\n谢谢你的回信。\n\n[[LETTER]] {"to":"ana@x.org","subject":"Re: 驻地","summary":"回 Ana，确认档期","body":"Dear Ana,\\n\\nThanks.\\n\\nHu Di"}'
  const { clean, letter } = extractLetter(raw)
  assert.equal(clean, '亲爱的 Ana：\n\n谢谢你的回信。')
  assert.equal(letter.to, 'ana@x.org')
  assert.equal(letter.subject, 'Re: 驻地')
  assert.equal(letter.summary, '回 Ana，确认档期')
  assert.equal(letter.reply_to, null)
  assert.equal(letter.thread_id, null)
})

test('没有信封就当没有，正文原样交出', () => {
  const { clean, letter } = extractLetter('就是一段普通回复。')
  assert.equal(clean, '就是一段普通回复。')
  assert.equal(letter, null)
})

// 2026-08-18：不变量是**不许丢**，不是「剁干净」。
// 信的正文住进信封之后，解析失败还照剁的话，丢掉的是整封信。
test('信封坏了不能连累正文', () => {
  const raw = '正文在这儿。\n\n[[LETTER]] {坏掉的 json'
  const { clean, letter } = extractLetter(raw)
  assert.ok(clean.includes('正文在这儿。'), '正文被咬了')
  assert.equal(letter, null)
})

test('没有收件人的信封不算信封——发不出去的信封是骗人的', () => {
  const raw = '正文。\n\n[[LETTER]] {"subject":"没有收件人"}'
  const { letter } = extractLetter(raw)
  assert.equal(letter, null)
})

test('收件人一律小写去空格', () => {
  const raw = '正文。\n\n[[LETTER]] {"to":"  Ana@X.ORG ","body":"信在这儿"}'
  assert.equal(extractLetter(raw).letter.to, 'ana@x.org')
})

test('主题没给就有个兜底的，不留 null 给界面', () => {
  const { letter } = extractLetter('正文。\n\n[[LETTER]] {"to":"a@b.c","body":"信在这儿"}')
  assert.equal(letter.subject, '（无主题）')
  assert.equal(letter.summary, null)
})

test('回信带上原信的 Message-ID 和 threadId', () => {
  const raw = '正文。\n\n[[LETTER]] {"to":"a@b.c","reply_to":"<x@y>","thread_id":"t1","body":"信在这儿"}'
  const { letter } = extractLetter(raw)
  assert.equal(letter.reply_to, '<x@y>')
  assert.equal(letter.thread_id, 't1')
})

test('信封坏了，正文照旧一个字不少——这是这儿最要紧的一条', () => {
  const body = '这是它想了半天写出来的一整封信。\n\n第二段。'
  assert.ok(extractLetter(`${body}\n\n[[LETTER]] {`).clean.includes(body))
})

// ── 信本身住在信封里（2026-08-18）────────────────────────────
//
// 起因是一次真事：收进产出的是「好的，我帮你回一封……」那一整段车轱辘话，
// 而不是信。因为信封只带了 to/subject，没带信 —— 于是界面只能把整条消息
// 当正文交出去。

test('信封带着信本身', () => {
  const raw = '我起了一版，你看看。\n\n[[LETTER]] ' + JSON.stringify({
    to: 'ana@x.org', subject: 'Re: 驻地', summary: '回 Ana',
    body: 'Dear Ana,\n\nThanks for getting back.\n\nBest,\nHu Di',
  })
  const { clean, letter } = extractLetter(raw)
  assert.equal(clean, '我起了一版，你看看。')
  assert.match(letter.body, /^Dear Ana,/)
  assert.match(letter.body, /Hu Di$/)
})

test('没有信正文就不算信封——不然收进产出的又是那段车轱辘话', () => {
  const raw = '正文。\n\n[[LETTER]] {"to":"a@b.c","subject":"s"}'
  assert.equal(extractLetter(raw).letter, null)
})

test('信正文只有空白也不算', () => {
  const raw = '正文。\n\n[[LETTER]] {"to":"a@b.c","subject":"s","body":"   \\n "}'
  assert.equal(extractLetter(raw).letter, null)
})
