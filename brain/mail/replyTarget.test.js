import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseSubject, looksLikeReply, pickReplyTarget } from './replyTarget.js'

// 真例：Megha 那封（2026-10-26）。标题是 Re:，原信在记录里，草稿却存成了「新起的一封」。
const H = [
  { message_id: '<a@mail>', gmail_thread_id: 't1', gmail_message_id: 'g1', from_email: 'meghajairaj2@gmail.com', counterpart_email: 'meghajairaj2@gmail.com', direction: 'in', subject: 'Re: Show Invitation', sent_at: '2026-10-23T04:42:26Z' },
  { message_id: '<b@mail>', gmail_thread_id: 't1', gmail_message_id: 'g2', from_email: 'meghajairaj2@gmail.com', counterpart_email: 'meghajairaj2@gmail.com', direction: 'in', subject: 'Re: Show Invitation', sent_at: '2026-10-27T04:42:30Z' },
  { message_id: '<c@mail>', gmail_thread_id: 't1', gmail_message_id: 'g3', from_email: 'me@x.com', counterpart_email: 'meghajairaj2@gmail.com', direction: 'out', subject: 'Re: Show Invitation', sent_at: '2026-10-28T00:00:00Z' },
  { message_id: '<d@mail>', gmail_thread_id: 't2', gmail_message_id: 'g4', from_email: 'meghajairaj2@gmail.com', counterpart_email: 'meghajairaj2@gmail.com', direction: 'in', subject: 'Something else', sent_at: '2026-10-29T00:00:00Z' },
]

test('主题去掉 Re: / Fwd: / 回复：之后比较', () => {
  assert.equal(baseSubject('Re: RE: Fwd: Show  Invitation'), 'show invitation')
  assert.equal(baseSubject('回复：展览邀请'), '展览邀请')
  assert.equal(looksLikeReply('Re: Show Invitation'), true)
  assert.equal(looksLikeReply('Show Invitation'), false)
})

test('回复对方最近那封同主题的来信，带上串号', () => {
  assert.deepEqual(pickReplyTarget({ to: 'MeghaJairaj2@gmail.com', subject: 'Re: Show Invitation', headers: H }),
    { reply_to: '<b@mail>', thread_id: 't1', gmail_message_id: 'g2', sent_at: '2026-10-27T04:42:30Z' })
})

test('收件人是数组也认；自己发出的信、别的主题、草稿都不算', () => {
  assert.equal(pickReplyTarget({ to: ['meghajairaj2@gmail.com'], subject: 'Show Invitation', headers: H }).reply_to, '<b@mail>')
  assert.equal(pickReplyTarget({ to: 'meghajairaj2@gmail.com', subject: 'Re: Totally new', headers: H }), null)
  assert.equal(pickReplyTarget({ to: 'meghajairaj2@gmail.com', subject: 'Re: Show Invitation', headers: H.map((h) => ({ ...h, is_draft: true })) }), null)
  assert.equal(pickReplyTarget({ to: 'other@x.com', subject: 'Re: Show Invitation', headers: H }), null)
})
