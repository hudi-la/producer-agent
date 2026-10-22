import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gmailToolsServer, OWN_GMAIL_TOOLS } from './tools.js'

const b64 = (s) => Buffer.from(s).toString('base64url')
const msg = (id, threadId, from, subject, body, extra = []) => ({
  id, threadId, internalDate: '1759700000000', labelIds: ['INBOX'], snippet: body.slice(0, 20),
  payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: from }, { name: 'To', value: 'me@x.com' }, { name: 'Subject', value: subject }, ...extra], body: { data: b64(body) } },
})

function fakeGmail() {
  const drafts = []
  const m1 = msg('m1', 't1', 'Ana <ana@org.org>', 'Residency', 'Hi — Ana, Curator at Org', [{ name: 'Message-ID', value: '<abc@org.org>' }])
  return {
    drafts,
    users: {
      threads: {
        list: async ({ q }) => ({ data: { threads: q.includes('ana') ? [{ id: 't1' }] : [] } }),
        get: async ({ id }) => ({ data: { id, messages: [m1] } }),
      },
      messages: { get: async ({ id }) => ({ data: m1 }) },
      drafts: { create: async ({ requestBody }) => { drafts.push(requestBody); return { data: { id: 'd1', message: { threadId: requestBody.message.threadId } } } } },
    },
  }
}
const tool = (server, name) => server.__specs.find((s) => s.name === name).handler
const out = (r) => r.content[0].text

test('四件工具都在,名字是 mcp__gmail__*;没有发送', () => {
  const s = gmailToolsServer({ gmail: fakeGmail(), me: 'me@x.com' })
  assert.deepEqual(s.__specs.map((x) => x.fullName), OWN_GMAIL_TOOLS)
  assert.ok(!s.__specs.some((x) => /send/.test(x.name)))
})

test('搜、读整串(带正文)、读一封', async () => {
  const s = gmailToolsServer({ gmail: fakeGmail(), me: 'me@x.com' })
  const found = JSON.parse(out(await tool(s, 'search_threads')({ query: 'from:ana@org.org' })))
  assert.equal(found[0].threadId, 't1'); assert.equal(found[0].last.from, 'Ana <ana@org.org>')
  assert.match(out(await tool(s, 'search_threads')({ query: 'nobody' })), /没搜到/)
  const th = JSON.parse(out(await tool(s, 'get_thread')({ thread_id: 't1' })))
  assert.equal(th[0].body, 'Hi — Ana, Curator at Org')
  const one = JSON.parse(out(await tool(s, 'get_message')({ message_id: 'm1', with_body: false })))
  assert.equal(one.threadId, 't1'); assert.equal(one.body, undefined)
})

test('建草稿:回复挂进原串、带引用头;只建不发', async () => {
  const g = fakeGmail()
  const s = gmailToolsServer({ gmail: g, me: 'me@x.com', fromName: 'Hu Di' })
  const r = JSON.parse(out(await tool(s, 'create_draft')({ to: ['ana@org.org'], subject: 'Re: Residency', body: '**Thanks**', reply_to_message_id: 'm1' })))
  assert.deepEqual(r, { draft_id: 'd1', thread_id: 't1', to: 'ana@org.org' })
  const raw = Buffer.from(g.drafts[0].message.raw, 'base64url').toString()
  assert.match(raw, /In-Reply-To: <abc@org.org>/)
  assert.match(raw, /To: ana@org.org/)
})

test('Gmail 报错不炸,回一句话给模型', async () => {
  const g = fakeGmail(); g.users.threads.get = async () => { throw Object.assign(new Error('boom'), { code: 500 }) }
  const s = gmailToolsServer({ gmail: g, me: 'me@x.com' })
  assert.match(out(await tool(s, 'get_thread')({ thread_id: 't1' })), /出错了/)
})
