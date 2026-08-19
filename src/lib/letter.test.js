import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saidThisTime, GIST_CAP } from './letter.js'

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
