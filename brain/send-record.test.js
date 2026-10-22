import test from 'node:test'
import assert from 'node:assert/strict'
import { recordSent } from './send-record.js'

const SENT = { id: 'm1', threadId: 't1', messageId: '<x@y>' }
const BASE = {
  ownerKind: 'contact', ownerId: 'c1', deliverableId: 'd1',
  sent: SENT, to: 'a@b.c', from: 'me@x.com', subject: 's',
  summary: '一句话', body: '正文', accountId: 'acc1',
}

const stubDb = (failAt = null) => {
  const seen = []
  const args = []
  return {
    seen,
    args,
    rpc: async (fn, a) => {
      seen.push(fn)
      args.push([fn, a])
      if (fn === failAt) return { data: null, error: { message: '故意坏的' } }
      return { data: {}, error: null }
    },
  }
}
const argOf = (db, fn) => db.args.find(([n]) => n === fn)?.[1]

test('先记账、后删产出——顺序反了会两头空', async () => {
  const db = stubDb()
  await recordSent(db, BASE)
  assert.deepEqual(db.seen, [
    'pa_add_mail', 'pa_mail_headers_upsert', 'pa_claim_contact_thread', 'pa_delete_deliverable',
  ])
})

test('机会线走 pa_link_thread，不是 pa_claim_contact_thread', async () => {
  const db = stubDb()
  await recordSent(db, { ...BASE, ownerKind: 'pursuit', ownerId: 'p1' })
  assert.ok(db.seen.includes('pa_link_thread'))
  assert.ok(!db.seen.includes('pa_claim_contact_thread'))
  assert.equal(argOf(db, 'pa_add_mail').p_pursuit_id, 'p1')
})

test('记账失败就不许删产出——信发出去了，那份稿子是唯一的凭据', async () => {
  const db = stubDb('pa_add_mail')
  await assert.rejects(() => recordSent(db, BASE), /记账没成/)
  assert.ok(!db.seen.includes('pa_delete_deliverable'))
})

test('信头写失败也不许删——0055 靠那几个头认亲，稿子得留着让你能重来', async () => {
  const db = stubDb('pa_mail_headers_upsert')
  await assert.rejects(() => recordSent(db, BASE), /记信头没成/)
  assert.ok(!db.seen.includes('pa_delete_deliverable'))
})

test('往来那条记的是「你」发的，带正文全文', async () => {
  const db = stubDb()
  await recordSent(db, BASE)
  const a = argOf(db, 'pa_add_mail')
  assert.equal(a.p_role, 'artist')
  assert.equal(a.p_gmail_message_id, 'm1')
  assert.equal(a.p_counterpart, 'a@b.c')
  assert.equal(a.p_body_raw, '正文')
  assert.equal(a.p_content, '一句话')
})

test('没有摘要就退回正文首段——往来里那行绝不能是空的', async () => {
  const db = stubDb()
  await recordSent(db, {
    ...BASE, summary: null,
    body: '第一段说了这件事。\n\n第二段说别的。',
  })
  assert.equal(argOf(db, 'pa_add_mail').p_content, '第一段说了这件事。')
})

test('正文也空的时候还有最后一层兜底，不留空白行', async () => {
  const db = stubDb()
  await recordSent(db, { ...BASE, summary: null, body: '   ' })
  assert.ok(argOf(db, 'pa_add_mail').p_content.trim().length > 0)
})

test('信头这一行带着我们自己生成的 Message-ID 和方向', async () => {
  const db = stubDb()
  await recordSent(db, { ...BASE, replyTo: '<old@y>', refs: ['<old@y>'] })
  const row = argOf(db, 'pa_mail_headers_upsert').p_rows[0]
  assert.equal(row.direction, 'out')
  assert.equal(row.message_id, '<x@y>')
  assert.equal(row.in_reply_to, '<old@y>')
  assert.deepEqual(row.refs, ['<old@y>'])
  assert.equal(row.from_email, 'me@x.com')
  assert.deepEqual(row.to_emails, ['a@b.c'])
  assert.equal(row.counterpart_email, 'a@b.c')
  assert.equal(row.gmail_thread_id, 't1')
  assert.ok(row.sent_at, 'sent_at 不能空——pa_mail_headers_upsert 会把没有它的行滤掉')
})

test('Gmail 没回 threadId 就不认领，但账照记、产出照删', async () => {
  const db = stubDb()
  await recordSent(db, { ...BASE, sent: { ...SENT, threadId: '' } })
  assert.deepEqual(db.seen, ['pa_add_mail', 'pa_mail_headers_upsert', 'pa_delete_deliverable'])
})

// ── 回给一群人（2026-08-18）──────────────────────────────────
//
// 起因：Huntington 那封该回给两个人，而这儿只放得下一个地址、抄送根本不存在。

test('回给多个人：信头里名单是全的，「对面」只挑第一个', async () => {
  const db = stubDb()
  await recordSent(db, { ...BASE, to: ['first@x.org', 'second@x.org'], cc: ['boss@y.org'] })

  const [, add] = db.args.find(([fn]) => fn === 'pa_add_mail')
  assert.equal(add.p_counterpart, 'first@x.org', '对面只能有一个，取 To 里第一个')
  assert.deepEqual(add.p_meta.to, ['first@x.org', 'second@x.org'])
  assert.deepEqual(add.p_meta.cc, ['boss@y.org'])

  const [, hdr] = db.args.find(([fn]) => fn === 'pa_mail_headers_upsert')
  assert.deepEqual(hdr.p_rows[0].to_emails, ['first@x.org', 'second@x.org'])
  assert.deepEqual(hdr.p_rows[0].cc_emails, ['boss@y.org'])
  assert.equal(hdr.p_rows[0].counterpart_email, 'first@x.org')
})

test('老产出那种单个字符串照旧记得下', async () => {
  const db = stubDb()
  await recordSent(db, { ...BASE, to: 'solo@x.org' })
  const [, hdr] = db.args.find(([fn]) => fn === 'pa_mail_headers_upsert')
  assert.deepEqual(hdr.p_rows[0].to_emails, ['solo@x.org'])
  assert.deepEqual(hdr.p_rows[0].cc_emails, [])
})

test('一个收件人都没有时不许记账——记进去也认不出这封信是给谁的', async () => {
  await assert.rejects(() => recordSent(stubDb(), { ...BASE, to: [] }), /没有收件人/)
})
