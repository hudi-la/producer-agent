import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canRewind, dropFrom, wipeCount } from './rewind.js'

// 这份规则在库里也有一份（0066 的 pa_rewind_chat）。两边**必须逐条对应** ——
// 飘了的话，界面上消失的和库里撤掉的就不是同一批，而你只能看见界面那一份：
// 屏幕上干净了，Fairwind 却还在按那句错话想事情。
//
// 所以这些 case 就是那道迁移的验收清单，一条对一条。

const say  = (id, content = '') => ({ id, role: 'artist',   kind: 'message', content })
const back = (id, content = '') => ({ id, role: 'producer', kind: 'message', content })

test('从你点的那句起，往后的一来一回全撤掉', () => {
  const msgs = [say('a'), back('b'), say('c'), back('d')]
  assert.deepEqual(dropFrom(msgs, 'c').map((m) => m.id), ['a', 'b'])
})

test('点最早那句 = 整条对话重来', () => {
  const msgs = [say('a'), back('b'), say('c')]
  assert.deepEqual(dropFrom(msgs, 'a'), [])
})

test('点最后那句 —— 它自己也要撤，不然重说完会有两句一样的', () => {
  const msgs = [say('a'), back('b'), say('c')]
  assert.deepEqual(dropFrom(msgs, 'c').map((m) => m.id), ['a', 'b'])
})

// ── 撤对话，不撤发生过的事 ────────────────────────────────────

test('邮件留着 —— 那封信真的收到了，你改口不能让它没发生', () => {
  const mail = { id: 'm', role: 'org', kind: 'email', content: '' }
  const sent = { id: 's', role: 'artist', kind: 'email', content: '' }
  const msgs = [say('a'), mail, back('b'), sent, say('c')]
  assert.deepEqual(dropFrom(msgs, 'a').map((m) => m.id), ['m', 's'])
})

test('你记的备注和决定留着 —— 那是你自己记下的事实', () => {
  const note = { id: 'n', role: 'note', kind: 'note', content: '' }
  const dec  = { id: 'd', role: 'note', kind: 'decision', content: '' }
  const msgs = [say('a'), note, back('b'), dec]
  assert.deepEqual(dropFrom(msgs, 'a').map((m) => m.id), ['n', 'd'])
})

test('讲懂和草稿留着 —— 草稿被右栏产出指着，撤了那条线索就断', () => {
  const brief = { id: 'br', role: 'producer', kind: 'brief', content: '' }
  const draft = { id: 'dr', role: 'producer', kind: 'draft', content: '' }
  const msgs = [brief, say('a'), draft, back('b')]
  assert.deepEqual(dropFrom(msgs, 'a').map((m) => m.id), ['br', 'dr'])
})

test('这句之前的一个字都不动', () => {
  const msgs = [say('a'), back('b'), say('c'), back('d'), say('e')]
  assert.deepEqual(dropFrom(msgs, 'c').map((m) => m.id), ['a', 'b'])
})

test('kind 缺省当普通对话 —— 老行没写 kind，别把它们漏在库里', () => {
  const msgs = [{ id: 'a', role: 'artist' }, { id: 'b', role: 'producer' }]
  assert.deepEqual(dropFrom(msgs, 'a'), [])
})

test('库里没有这条 id 就原样返回，不瞎撤', () => {
  const msgs = [say('a'), back('b')]
  assert.deepEqual(dropFrom(msgs, '不存在的'), msgs)
})

// ── 「后面还有几条」那句话 ────────────────────────────────────

test('数的是这句后面的，不含这句本身', () => {
  const msgs = [say('a'), back('b'), say('c'), back('d')]
  assert.equal(wipeCount(msgs, 'a'), 3)
  assert.equal(wipeCount(msgs, 'c'), 1)
})

test('最后那句后面没有别的了', () => {
  const msgs = [say('a'), back('b'), say('c')]
  assert.equal(wipeCount(msgs, 'c'), 0)
})

test('中间夹的信不算进「后面几条」—— 它不会消失，不能吓唬人', () => {
  const mail = { id: 'm', role: 'org', kind: 'email' }
  const msgs = [say('a'), mail, back('b')]
  assert.equal(wipeCount(msgs, 'a'), 1)
})

// ── 哪几条能点「改这句」 ──────────────────────────────────────

test('只有你自己说的普通话能改', () => {
  assert.equal(canRewind(say('a')), true)
  assert.equal(canRewind(back('b')), false)
  assert.equal(canRewind({ id: 'm', role: 'org', kind: 'email' }), false)
  assert.equal(canRewind({ id: 's', role: 'artist', kind: 'email' }), false)
  assert.equal(canRewind({ id: 'n', role: 'note', kind: 'note' }), false)
})

test('还没落库的那条（乐观插进去的 tmp-）不能改 —— 库里还没有它的 id', () => {
  assert.equal(canRewind({ id: 'tmp-1723700000000', role: 'artist', kind: 'message' }), false)
})

test('没有 id 的不能改', () => {
  assert.equal(canRewind({ role: 'artist', kind: 'message' }), false)
})
