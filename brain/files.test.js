import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, imageBudget, isImage, IMG_CAP, IMG_MAX_BYTES } from './files.js'

// ── 图片这条路 ──────────────────────────────────────────────

test('PNG 不再被当成读不了的东西，走图片这条路出去', async () => {
  const buf = Buffer.from('假装这是 PNG 的字节')
  const got = await read(buf, 'sketch.png', 'image/png')
  assert.equal(got.kind, 'image')
  assert.equal(got.mimeType, 'image/png')
  assert.equal(got.data, buf.toString('base64'))
})

test('mime 认不出的时候按扩展名认图', async () => {
  // 很多地方上传图片给的是 application/octet-stream
  const got = await read(Buffer.from('x'), 'poster.JPG', 'application/octet-stream')
  assert.equal(got.kind, 'image')
  assert.equal(got.mimeType, 'image/jpeg')
})

test('模型看不了的图片格式明说是格式的事，不说成「读不了」', async () => {
  await assert.rejects(
    () => read(Buffer.from('x'), 'shot.heic', 'image/heic'),
    (err) => err.message.includes('heic') && err.message.includes('PNG'),
  )
})

test('太大的图不塞进去 —— 塞了 API 那边也会拒收', async () => {
  const big = Buffer.alloc(IMG_MAX_BYTES + 1)
  await assert.rejects(
    () => read(big, 'huge.png', 'image/png'),
    (err) => err.message.includes('太大'),
  )
})

test('文本那条路一点没变', async () => {
  const got = await read(Buffer.from('# 标题\n正文'), 'note.md', 'text/markdown')
  assert.equal(got.kind, 'text')
  assert.equal(got.text, '# 标题\n正文')
})

test('清单要不下载就认得出哪些是图 —— 它得据此决定开不开', () => {
  assert.equal(isImage('a.png', 'application/octet-stream'), true)
  assert.equal(isImage('a.JPEG', null), true)
  assert.equal(isImage('deck.pdf', 'application/pdf'), false)
  // 看得了的才算图。heic 归到「开不了」那边，清单上就不该写着"图"勾他去开
  assert.equal(isImage('shot.heic', 'image/heic'), false)
})

// ── 图片的成本闸门 ──────────────────────────────────────────
//
// 图跟文本不一样：文本开完就在那一轮的工具结果里，图进了上下文就一直在，
// 这条对话后面每一轮都要重付一次。所以「按需开」不能只写在提示词里指望它听话。

test('同一张图第二次不再进上下文', () => {
  const budget = imageBudget()
  assert.equal(budget.admit('a.png').ok, true)
  const again = budget.admit('a.png')
  assert.equal(again.ok, false)
  assert.match(again.why, /已经/)
})

test('一条对话里图片有个数上限', () => {
  const budget = imageBudget()
  for (let i = 0; i < IMG_CAP; i++) assert.equal(budget.admit(`${i}.png`).ok, true)
  const over = budget.admit('one-too-many.png')
  assert.equal(over.ok, false)
  assert.match(over.why, new RegExp(String(IMG_CAP)))
})

test('文本不占图片的额度', () => {
  const budget = imageBudget()
  for (let i = 0; i < IMG_CAP + 5; i++) budget.text()
  assert.equal(budget.admit('a.png').ok, true)
})
