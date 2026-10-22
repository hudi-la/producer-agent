import {test,mock} from 'node:test'
import assert from 'node:assert/strict'
const calls=[]
const rpcCalls=[]
mock.module('./backends.js',{namedExports:{BRAIN:'https://example.invalid',supa:{rpc:async(...args)=>{rpcCalls.push(args);return {data:{ok:true},error:null}}},brainFetch:async(...args)=>{calls.push(args);return {ok:true,json:async()=>({id:'saved'})}}}})
const {artifactRequest}=await import('./artifacts.js')
test('artifact creation and Gmail draft requests use the authenticated hosted transport',async()=>{
 await artifactRequest('/artifact',{contactId:'c'},{message_id:'m'})
 await artifactRequest('/gmail-draft',{pursuitId:'p'},{deliverable_id:'d'})
 assert.deepEqual(calls.map(c=>c[0]),['https://example.invalid/artifact','https://example.invalid/gmail-draft'])
 assert.deepEqual(calls.map(c=>JSON.parse(c[1].body)),[{contact_id:'c',message_id:'m'},{pursuit_id:'p',deliverable_id:'d'}])
})
test('discard and restore preserve the authenticated database RPC contract',async()=>{
 const {setArtifactDiscarded}=await import('./artifacts.js')
 await setArtifactDiscarded('artifact-1',true)
 await setArtifactDiscarded('artifact-1',false)
 assert.deepEqual(rpcCalls,[['pa_set_artifact_discarded',{p_id:'artifact-1',p_discarded:true}],['pa_set_artifact_discarded',{p_id:'artifact-1',p_discarded:false}]])
})
