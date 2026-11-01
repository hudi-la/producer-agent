import test from 'node:test'
import assert from 'node:assert/strict'
import { attachmentKind, loadAttachment } from './attachmentPreview.js'
const file = { filename: '记录.html', mime: 'text/html', storage_key: 'private/key' }
const opts = (fetcher) => ({ sign: async () => 'signed', fetcher, urls: { createObjectURL: () => 'blob:test', revokeObjectURL() {} } })
test('HTML classification uses registered metadata, not storage response type', () => {
  assert.equal(attachmentKind(file), 'html')
  assert.equal(attachmentKind({ filename: 'foo.html', mime: 'text/plain' }), 'html')
  assert.equal(attachmentKind({ mime: 'image/svg+xml' }), 'download')
})
test('UTF-8 bytes decode regardless of response content type; download URL released', async () => {
  let released = false
  const options = opts(async () => new Response('中文提交记录', { headers: { 'content-type': 'text/plain' } }))
  options.urls.revokeObjectURL = () => { released = true }
  const result = await loadAttachment(file, options)
  assert.equal(result.text, '中文提交记录'); result.release(); assert.equal(released, true)
})
test('HTTP errors expose a direct fallback, retry can succeed', async () => {
  const options = opts(async () => new Response('', { status: 403 }))
  await assert.rejects(loadAttachment(file, options), error => error.message.includes('403') && error.downloadUrl === 'signed')
  options.fetcher = async () => new Response('恢复')
  assert.equal((await loadAttachment(file, options)).text, '恢复')
})
test('aborted signing never starts a stale fetch', async () => {
  const controller = new AbortController(); let fetched = false
  const options = opts(async () => { fetched = true }); options.signal = controller.signal
  options.sign = async () => { controller.abort(); return 'signed' }
  await assert.rejects(loadAttachment(file, options), { name: 'AbortError' }); assert.equal(fetched, false)
})
test('missing key does not call signing', async () => {
  await assert.rejects(loadAttachment({}, { sign: () => assert.fail() }), /没有可读取/)
})
