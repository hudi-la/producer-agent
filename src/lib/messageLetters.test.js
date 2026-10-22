import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLetters, messageLetters, matchesArtifact } from './messageLetters.js'
import { artifactFields } from '../../brain/artifacts.js'
const a={to:'leo@example.com',subject:'Same subject',body:'Dear Leo,\nBody with "quotes", } and [[LETTER]] text.'}
const b={to:'suibi@example.com',subject:'Same subject',body:'Dear Suibi,\nDifferent body.'}
const wrap=x=>'[[LETTER]] '+JSON.stringify(x)
test('two complete letters and prose, without exposed envelopes',()=>{
 const out=parseLetters('Introduction\n'+wrap(a)+'\nBetween\n'+wrap(b)+'\nAfter')
 assert.equal(out.clean,'Introduction\n\nBetween\n\nAfter');assert.deepEqual(out.letters.map(x=>x.body),[a.body,b.body])
})
test('legacy raw first letter plus stored last retains independent stable identities',()=>{
 const m={id:'m',role:'producer',content:'Introduction\n'+wrap(a),meta:{letter:b}}
 const view=messageLetters(m);assert.equal(view.clean,'Introduction');assert.deepEqual(view.letters.map(x=>x.index),[1,0])
 const one=artifactFields(m,1),two=artifactFields(m,0)
 assert.equal(one.p_meta.to,a.to);assert.equal(one.p_body,a.body);assert.equal(two.p_meta.to,b.to)
 assert(matchesArtifact({meta:{artifact_message_id:'m'}},'m',0));assert(!matchesArtifact({meta:{artifact_message_id:'m'}},'m',1))
 assert(matchesArtifact({meta:one.p_meta},'m',1));assert(!matchesArtifact({meta:one.p_meta},'m',0))
 assert.throws(()=>artifactFields(m,2),/没有/)
})
test('new metadata has same indexes as legacy and no duplicate final letter',()=>{
 const letters=parseLetters(wrap(a)+'\n'+wrap(b)).letters
 const view=messageLetters({role:'producer',content:'Introduction',meta:{letters,letter:letters[1]}})
 assert.equal(view.letters.length,2);assert.deepEqual(view.letters.map(x=>x.index),[1,0])
})
test('malformed and invalid envelopes preserve content and do not swallow following valid letter',()=>{
 const malformed='[[LETTER]] {broken\n', invalid=wrap({to:'bad',body:'Keep me'})
 const out=parseLetters(malformed+invalid+'\n'+wrap(b)+'\n[[STATE]] {"a":1}')
 assert.equal(out.letters.length,1);assert(out.clean.includes(malformed.trim()));assert(out.clean.includes(invalid));assert(out.clean.includes('[[STATE]]'))
})
test('only producer messages are interpreted as drafts',()=>{
 const raw=wrap(a);assert.deepEqual(messageLetters({role:'artist',content:raw}),{clean:raw,letters:[]})
})

test('new reply extraction persists every letter and keeps old last-letter field', async()=>{
 const {extractLetters}=await import('../../brain/letter.js')
 const result=extractLetters('Intro\n'+wrap(a)+'\n'+wrap(b)+'\n[[STATE]] {"stage":"waiting"}')
 assert.equal(result.letters.length,2);assert.equal(result.letter.to,b.to);assert(!result.clean.includes('[[LETTER]]'));assert(result.clean.includes('[[STATE]]'))
})
