import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saveDraft } from './draft.js'
import { asAuthErrorIfItIs } from './auth.js'
const content = { from: 'me@example.com', to: ['me@example.com'], subject: 'Test', body: 'Approved text' }
test('create draft preserves exact recipients and text without sending', async () => {
  let request
  const gmail = { users: { drafts: { create: async a => { request = a; return { data: { id: 'd', message: { threadId: 't' } } } } } } }
  const result = await saveDraft({ ...content, gmail })
  assert.equal(result.draft_id, 'd')
  const mime = Buffer.from(request.requestBody.message.raw, 'base64url').toString()
  assert.match(mime, /To: me@example.com/)
  assert.ok(mime.includes(Buffer.from(content.body).toString('base64')))
})
test('saving an existing draft updates it instead of creating a duplicate', async () => {
  let id
  const gmail = { users: { drafts: { update: async a => { id = a.id; return { data: { id } } } } } }
  await saveDraft({ ...content, gmail, draftId: 'existing' })
  assert.equal(id, 'existing')
})
test('missing scope is explained separately from expired authorization', () => {
  const err = asAuthErrorIfItIs({ code: 403, response: { data: { error: { message: 'Request had insufficient authentication scopes.' } } } })
  assert.match(err.message, /已连接.*未授予/)
  assert.doesNotMatch(err.message, /object Object/)
})
