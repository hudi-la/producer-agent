import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLike, provenance, decide, namesFromMessage } from './copied.js'

// ── 人还是信箱 ───────────────────────────────────────────────────
// 把 programs@ 建成一张名片是 0033 犯过的错；把 Meighan 当成信箱则是
// 她的真回信永远进不了卡片。两边都不许。

test('有人名署名的，是人', () => {
  assert.equal(looksLike({ email: 'meighan@printmuseum.org', name: 'Meighan Maguire' }), 'person')
  assert.equal(looksLike({ email: 'lorna@printmuseum.org', name: 'Lorna' }), 'person')
})

test('info@ / programs@ 这种本地部分，不管署名叫什么都是信箱', () => {
  assert.equal(looksLike({ email: 'programs@descanso.org', name: 'Francesca Smith' }), 'mailbox')
  assert.equal(looksLike({ email: 'info@pam.usc.edu', name: null }), 'mailbox')
})

test('署名就是机构名、或全大写缩写，是信箱', () => {
  assert.equal(looksLike({ email: 'ipm@printmuseum.org', name: 'International Printing Museum',
                           org: 'International Printing Museum' }), 'mailbox')
  assert.equal(looksLike({ email: 'ipm@printmuseum.org', name: 'IPM' }), 'mailbox')
})

test('没署名的看不出来——不编名字', () => {
  assert.equal(looksLike({ email: 'rachel.masters@arboretum.org', name: null }), 'unsure')
  assert.equal(looksLike({ email: 'x@y.org', name: 'x@y.org' }), 'unsure')
})

// ── 该走哪条路 ───────────────────────────────────────────────────

const base = {
  email: 'rachel.masters@arboretum.org', name: 'Rachel Masters', same_org: true,
  verdict: null, business: null, org_guess: 'Los Angeles County Arboretum',
}

test('同机构 + 像人 → 自动收', () => {
  assert.deepEqual(decide(base), { act: 'adopt' })
})

test('同机构但没署名 → 进等你点头，标成人、注明看不出', () => {
  assert.deepEqual(decide({ ...base, name: null }), { act: 'greet', verdict: 'person', unsure: true })
})

test('同机构但像共享信箱 → 进等你点头，标成机构信箱', () => {
  assert.deepEqual(decide({ ...base, email: 'programs@arboretum.org', name: 'Programs Team' }),
    { act: 'greet', verdict: 'shared_box' })
})

test('ipm@ 这种没署名的短地址，不猜它是信箱——端给你看，注明看不出', () => {
  assert.deepEqual(decide({ ...base, email: 'ipm@printmuseum.org', name: null }),
    { act: 'greet', verdict: 'person', unsure: true })
})

test('不同机构、没判过 → 进等你点头，不自动收', () => {
  assert.deepEqual(decide({ ...base, email: 'slapaewa@gmail.com', name: 'S. Lapaewa', same_org: false }),
    { act: 'greet', verdict: 'person', unsure: false })
})

test('不同机构、早有判定 → 不动它', () => {
  assert.equal(decide({ ...base, same_org: false, verdict: 'bulk' }).act, 'skip')
})

test('同机构的，哪怕被误判成群发也要收——休假自动回复害的', () => {
  assert.deepEqual(decide({ ...base, email: 'meighan@printmuseum.org', name: 'Meighan Maguire',
                             verdict: 'bulk', business: false, decided_by: 'rule' }), { act: 'adopt' })
})

// ── 来路那一句 ───────────────────────────────────────────────────
// 每一个自动收进来的人都得说得出是谁、什么时候、在哪条线带进来的。

const at = '2026-08-16T20:00:00-07:00'

test('对方回信时抄送的', () => {
  const p = provenance({ kind: 'cc', via_direction: 'in', via_name: 'Lorna Turner',
                         via_email: 'lorna@printmuseum.org', pursuit_title: '工作坊提案 · IPM', sent_at: at })
  assert.equal(p.base, 'Lorna Turner 8/16 在「工作坊提案 · IPM」回信时抄送了这个地址')
  assert.equal(p.party, 'Lorna Turner 8/16 回信时抄送了')
  assert.match(p.note, /自动收进通讯录/)
})

test('你写信时抄送的', () => {
  const p = provenance({ kind: 'cc', via_direction: 'out', via_name: 'Brooke Applegate',
                         pursuit_title: '合作开课 · Arboretum', sent_at: '2026-08-12T10:00:00-07:00' })
  assert.equal(p.base, '你 8/12 在「合作开课 · Arboretum」写给 Brooke Applegate 时抄送了这个地址')
})

test('收件人栏里的说「也发给了」', () => {
  const p = provenance({ kind: 'to', via_direction: 'in', via_name: 'Lorna', pursuit_title: 'X', sent_at: at })
  assert.match(p.base, /也发给了/)
})

test('从自己地址回信的', () => {
  const p = provenance({ kind: 'reply', pursuit_title: '工作坊提案 · IPM', sent_at: '2026-09-04T09:00:00-07:00' })
  assert.equal(p.base, '9/4 在「工作坊提案 · IPM」那条线的信串里回了信，跟线上的人同一个机构')
})

test('没有署名就用地址称呼带进来的人', () => {
  const p = provenance({ kind: 'cc', via_direction: 'in', via_name: null, via_email: 'a@b.org',
                         pursuit_title: 'X', sent_at: at })
  assert.match(p.base, /^a@b\.org /)
})

// ── 从信头补署名 ─────────────────────────────────────────────────

test('From/To/Cc 的署名都收，按地址索引', () => {
  const m = { payload: { headers: [
    { name: 'From', value: 'Lorna Turner <lorna@printmuseum.org>' },
    { name: 'To', value: 'Di Hu <hudi.creates@gmail.com>' },
    { name: 'Cc', value: 'Meighan Maguire <meighan@printmuseum.org>, ipm@printmuseum.org' },
  ] } }
  assert.deepEqual(namesFromMessage(m), {
    'lorna@printmuseum.org': 'Lorna Turner',
    'hudi.creates@gmail.com': 'Di Hu',
    'meighan@printmuseum.org': 'Meighan Maguire',
  })
})
