import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanSubject, groupLine, memberNote, unknownMembers, knownMembers, genericMembers, starterName,
} from './groupText.js'

const g = {
  thread: 't1', subject: 'Re: Re: Residency workshop series!',
  first_at: '2025-08-29', last_at: '2025-09-13', n_mails: 8, n_senders: 6, n_people: 16, n_unknown: 4,
  starter: { email: 'cmasters@calarts.edu', name: 'Cameron Masters', is_me: false },
  members: [
    { email: 'cmasters@calarts.edu', name: 'Cameron Masters', known: true, wrote: true },
    { email: 'valcogd@outlook.com', name: 'valeria costa', known: true, wrote: true },
    { email: 'a@x.org', name: 'A One', known: false, wrote: false },
    { email: 'b@y.org', name: null, known: false, wrote: true },
    { email: 'info@z.org', name: 'Z Org', known: false, generic: true },
    { email: 'c@w.org', name: 'C', known: false, rejected: true },
  ],
}

test('主题去掉 Re:/Fwd: 前缀，叠了几层也去干净', () => {
  assert.equal(cleanSubject('Re: Re: Residency workshop series!'), 'Residency workshop series!')
  assert.equal(cleanSubject('FW: Fwd: meeting online'), 'meeting online')
  assert.equal(cleanSubject('回复: 转发: 开会'), '开会')
  assert.equal(cleanSubject('  '), '（无主题）')
  assert.equal(cleanSubject(null), '（无主题）')
})

test('概况一句：谁发起、几个人、几封、什么时候', () => {
  assert.equal(groupLine(g), 'Cameron Masters 8/29 发起，16 个人在场，6 个人说过话，来回 8 封（8/29 → 9/13）')
})

test('同一天开始同一天结束，日期只说一次', () => {
  assert.match(groupLine({ ...g, last_at: '2025-08-29' }), /（8\/29）$/)
})

test('你自己发起的说「你」', () => {
  assert.equal(starterName({ starter: { is_me: true, name: 'Di Hu' } }), '你')
  assert.match(groupLine({ ...g, starter: { is_me: true } }), /^你 8\/29 发起/)
})

test('要收的：没进通讯录、不是共享信箱、他没否过的', () => {
  assert.deepEqual(unknownMembers(g).map((m) => m.email), ['a@x.org', 'b@y.org'])
  assert.deepEqual(knownMembers(g).map((m) => m.email), ['cmasters@calarts.edu', 'valcogd@outlook.com'])
  assert.deepEqual(genericMembers(g).map((m) => m.email), ['info@z.org'])
})

test('名片上那句：活动名是他定的，信串主题和发起人跟着写', () => {
  assert.equal(memberNote(g, 'CalArts 驻地 2025 秋'),
    '在「CalArts 驻地 2025 秋」里一起合作的人：Cameron Masters 2025-08 发起的信串「Residency workshop series!」，同在收件人里（一伙人一起收进通讯录，0122）')
})

test('空的组不炸', () => {
  assert.deepEqual(unknownMembers({}), [])
  assert.deepEqual(unknownMembers(null), [])
})
