import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saidThisTime, GIST_CAP, isLetter, isExchange, isContactTalk } from './letter.js'

test('Gmail 的 > 引用砍掉', () => {
  assert.equal(saidThisTime('Thanks!\n\n> old stuff\n> more old'), 'Thanks!')
})

test('On … wrote: 砍掉', () => {
  assert.equal(
    saidThisTime('Sounds great, thank you!\n\nOn Mon, Aug 17, 2026 at 1:38 PM Sarah wrote:\nold'),
    'Sounds great, thank you!')
})

// 真踩过：JS 的 . 不匹配换行，Gmail 折行之后整块引用留在框里
test('On … wrote: 折了行也砍得掉', () => {
  const t = 'Thank you! I will put it in my calendar!\n\n' +
    'On Tue, Aug 18, 2026 at 2:39 PM Biayna Bogosian\n<Biayna.Bogosian@asu.edu>\nwrote:\n> old'
  assert.equal(saidThisTime(t), 'Thank you! I will put it in my calendar!')
})

// 真踩过：Outlook 回信一条 > 都没有
test('Outlook 那条下划线 + From/Sent 块砍掉', () => {
  const t = "I'll send the link for 12pm.\n\n" +
    '________________________________\n' +
    'From: Di Hu <hudi.creates@gmail.com>\nSent: Tuesday, 18 August 2026 14:31:34\n'
  assert.equal(saidThisTime(t), "I'll send the link for 12pm.")
})

test('Outlook 手机版那句尾巴也砍掉', () => {
  assert.equal(saidThisTime('OK!\n\nGet Outlook for iOS<https://aka.ms/x>'), 'OK!')
})

test('签名分隔线砍掉', () => {
  assert.equal(saidThisTime('Best,\nSarah\n--\nSFCB · 375 Rhode Island'), 'Best,\nSarah')
})

test('没有引用的原样留着', () => {
  assert.equal(saidThisTime('Hi Sarah,\n\nJust checking in.'), 'Hi Sarah,\n\nJust checking in.')
})

// **空框比长框坏得多**：你会以为这封信没说话
test('整封都是引用 —— 退回原文，不给空框', () => {
  const t = '\n> only quoted\n> nothing else'
  assert.equal(saidThisTime(t), t.trim())
})

test('空的进空的出，不炸', () => {
  assert.equal(saidThisTime(''), '')
  assert.equal(saidThisTime(null), '')
})

test('取最早的那个标记 —— 别让后面的漏网', () => {
  const t = 'Real words.\n\n> quoted\n\nOn Mon, X wrote:\n'
  assert.equal(saidThisTime(t), 'Real words.')
})

test('露多少字有个上限', () => {
  assert.equal(GIST_CAP, 240)
})

// ── 这是不是一封真信 ────────────────────────────────────────────
// 判据流通过两个版本，第二个在 gmail_draft 出现那天变成了错的。
// 草稿也有 gmail_message_id —— 拿它当判据，草稿就会被当成信显示。

test('kind=email 是信', () => {
  assert.equal(isLetter({ kind: 'email', gmail_message_id: 'x' }), true)
})

test('**草稿不是信，哪怕它也有 gmail_message_id**', () => {
  assert.equal(isLetter({ kind: 'gmail_draft', gmail_message_id: 'x' }), false)
})

test('跟 Fairwind 的商量不是信', () => {
  assert.equal(isLetter({ kind: 'message' }), false)
  assert.equal(isLetter({ kind: 'brief' }), false)
})

test('空的不炸', () => {
  assert.equal(isLetter(null), false)
  assert.equal(isLetter({}), false)
})

test('往来 = 真信 + 你手记的；草稿不算', () => {
  assert.equal(isExchange({ kind: 'email' }), true)
  assert.equal(isExchange({ role: 'note', kind: 'decision' }), true)
  assert.equal(isExchange({ kind: 'meet' }), true)
  assert.equal(isExchange({ kind: 'gmail_draft', gmail_message_id: 'x' }), false)
  assert.equal(isExchange({ kind: 'message' }), false)
})

test('contact chat excludes sent-mail excerpts while retaining the original draft', () => {
  const draft = { id: 'draft', role: 'producer', kind: 'message', meta: { letter: { body: 'Complete letter' } } }
  const mail = { id: 'sent', role: 'artist', kind: 'email', gmail_message_id: 'gmail-sent' }
  const arrival = { id: 'notice', role: 'producer', kind: 'arrival', content: 'Hi Kiko, partial', meta: { dir: 'out', msg_id: mail.id } }
  assert.deepEqual([draft, mail, arrival].filter(isContactTalk), [draft])
  assert.equal(isExchange(mail), true)
  assert.equal(isContactTalk({ ...arrival, meta: { dir: 'in' } }), false)
  assert.equal(isContactTalk({ role: 'artist', kind: 'message' }), true)
  assert.equal(isContactTalk({ role: 'note', kind: 'meet' }), false)
})
