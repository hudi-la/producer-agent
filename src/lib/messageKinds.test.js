import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kindOf, KINDS, sentCopyOf, judgedText } from './messageKinds.js'

const NOW = new Date('2026-10-24T12:00:00Z')

test('每种消息只有一个身份；Gmail 草稿、告知、Fairwind 的判断不会冒充别的', () => {
  const cases = [
    [{ kind: 'email', role: 'org' }, 'mail_in'],
    [{ kind: 'email', role: 'artist', created_at: '2026-10-20' }, 'mail_out'],
    [{ kind: 'email', role: 'artist', created_at: '2026-10-27' }, 'mail_scheduled'],
    [{ kind: 'gmail_draft', role: 'artist' }, 'gmail_draft'],
    [{ kind: 'arrival', role: 'producer' }, 'arrival'],
    [{ kind: 'decision', role: 'note', meta: { state_move: { move: 'wait' } } }, 'decision_fw'],
    [{ kind: 'meet', role: 'note', meta: { state_move: { move: 'met' } } }, 'decision_fw'],
    [{ kind: 'note', role: 'note' }, 'note_you'],
    [{ kind: 'memo', role: 'note' }, 'memo_you'],
    [{ kind: 'message', role: 'artist' }, 'chat_you'],
    [{ kind: 'message', role: 'producer' }, 'chat_fw'],
    [{ kind: 'brief', role: 'producer' }, 'brief'],
  ]
  for (const [m, want] of cases) assert.equal(kindOf(m, NOW), want, JSON.stringify(m))
})

test('只有真实邮件和你亲手记的算事实', () => {
  const facts = Object.entries(KINDS).filter(([, v]) => v.fact).map(([k]) => k).sort()
  assert.deepEqual(facts, ['mail_in', 'mail_out', 'memo_you', 'note_you'])
})

test('草稿认得出已经发出的那封：开头一样、时间不早于草稿', () => {
  const body = 'Hi Mattie, following up on the floor plan and overnight power for the install.'
  const d = { kind: 'gmail_draft', role: 'artist', body_raw: body, created_at: '2026-10-08T10:00:00Z' }
  const s = { kind: 'email', role: 'artist', body_raw: body + '\n\nBest, Di', created_at: '2026-10-08T18:00:00Z' }
  assert.equal(sentCopyOf(d, [s]), s)
  assert.equal(sentCopyOf(d, [{ ...s, created_at: '2026-09-01T00:00:00Z' }]), null)
  assert.equal(sentCopyOf(d, [{ ...s, body_raw: 'Something else entirely, not the same letter at all.' }]), null)
  assert.equal(sentCopyOf({ ...d, body_raw: 'short' }, [s]), null)
})

test('Fairwind 的判断显示成「判了什么 + 凭什么 + 你当时那句」，问句不再像你记的事实', () => {
  const m = { kind: 'decision', role: 'note', content: '这个是什么啊', meta: { state_move: { line: '到 11/2', why: '还没开门' } } }
  assert.equal(judgedText(m), '到 11/2\n\n凭什么：还没开门\n\n> 这个是什么啊')
  const auto = { ...m, content: '聊天里定的：到 11/2' }
  assert.equal(judgedText(auto), '到 11/2\n\n凭什么：还没开门')
})
