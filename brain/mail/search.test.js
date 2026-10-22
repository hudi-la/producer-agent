import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mailReader, readableBody } from './search.js'
import { MailAuthError } from './auth.js'

test('Gmail search preserves query, pagination and message identity', async () => {
  let request
  const read = mailReader(async () => ({ users: { messages: {
    list: async args => { request = args; return { data: { messages: [{ id: 'm' }], nextPageToken: 'next' } } },
    get: async () => ({ data: { id: 'm', threadId: 't', payload: { headers: [{ name: 'Subject', value: 'Workshop invite' }] } } })
  } } }))
  const result = await read({ query: 'subject:Workshop', pageToken: 'page' })
  assert.equal(request.q, 'subject:Workshop'); assert.equal(request.pageToken, 'page')
  assert.equal(result.nextPageToken, 'next'); assert.equal(result.messages[0].subject, 'Workshop invite')
})
test('empty search and broken authorization have distinct outcomes', async () => {
  const empty = mailReader(async () => ({ users: { messages: { list: async () => ({ data: {} }) } } }))
  assert.deepEqual((await empty({ query: 'missing' })).messages, [])
  const broken = mailReader(async () => { throw new MailAuthError('expired') })
  const result = await broken({ query: 'invite' })
  assert.equal(result.needsAuth, true); assert.equal(result.error, 'expired'); assert.equal(result.messages, undefined)
})
test('reading a long email returns original text with a continuation offset', async () => {
  const text = 'x'.repeat(17000) + 'https://zoom.us/j/example'
  const read = mailReader(async () => ({ users: { messages: { get: async () => ({ data: {
    id: 'm', threadId: 't', payload: { mimeType: 'text/plain', body: { data: Buffer.from(text).toString('base64url') } }
  } }) } } }))
  assert.equal((await read({ id: 'm' })).nextOffset, 16000)
  const tail = await read({ id: 'm', from: 16000 })
  assert.match(tail.body, /zoom.us/); assert.equal(tail.nextOffset, null)
})

test('HTML invitation links survive extraction', () => {
  const payload = { mimeType: 'text/html', body: { data: Buffer.from('<a href="https://zoom.us/j/123?pwd=a&amp;x=b">Join meeting</a>').toString('base64url') } }
  assert.match(readableBody(payload), /https:\/\/zoom.us\/j\/123\?pwd=a&x=b/)
})
