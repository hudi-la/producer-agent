import {test,mock} from 'node:test'
import assert from 'node:assert/strict'
const calls=[]
mock.module('./backends.js',{namedExports:{BRAIN:'https://example.invalid',brainFetch:async(...args)=>{calls.push(args);return {ok:true,json:async()=>({id:'saved'})}}}})
const {artifactRequest}=await import('./artifacts.js')
test('artifact creation and Gmail draft requests use the authenticated hosted transport',async()=>{
 await artifactRequest('/artifact',{contactId:'c'},{message_id:'m'})
 await artifactRequest('/gmail-draft',{pursuitId:'p'},{deliverable_id:'d'})
 assert.deepEqual(calls.map(c=>c[0]),['https://example.invalid/artifact','https://example.invalid/gmail-draft'])
 assert.deepEqual(calls.map(c=>JSON.parse(c[1].body)),[{contact_id:'c',message_id:'m'},{pursuit_id:'p',deliverable_id:'d'}])
})
