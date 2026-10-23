import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mailEvidence, bodyFallback } from './evidence.js'
import { archiveFailures, archiveWarning } from './archive-status.js'
test('failure survives an empty subsequent sync, clears only after successful retry', () => {
 let f=archiveFailures([], {failed:['programs@example.test']})
 f=archiveFailures(f, {succeeded:[],failed:[]})
 assert.equal(archiveWarning(f).note,'1 个邮箱的邮件归档失败')
 assert.match(archiveWarning(f,true).note,/archiving failed/)
 assert.equal(archiveWarning(archiveFailures(f,{succeeded:f})),null)
})
test('one mailbox recovering does not clear another failure',()=>{
 assert.deepEqual(archiveFailures(['a','b'],{succeeded:['a'],failed:['b']}),['b'])
})
test('partial database failure is propagated after successful messages are checkpointed',async()=>{
 let src=await readFile(new URL('./adopt.js',import.meta.url),'utf8')
 src=src.replace(/^import .*$/gm,'').replace(/export /g,'')
 const marked=[]
 const deps={mailEvidence,bodyFallback,gmailFor:()=>({}),getFull:async()=>({payload:{}}),plainText:()=> 'Real body',authClient:async()=>({}),ask:async()=>{throw Error('model unavailable')},toPromote:async()=>[{gmail_message_id:'good',counterpart_email:'box',direction:'in'},{gmail_message_id:'bad',counterpart_email:'box',direction:'in'}],markPromoted:async ids=>marked.push(...ids),db:()=>({rpc:async(name,args)=>args.p_gmail_message_id==='bad'?{error:{message:'constraint violation'}}:{data:{inserted:true}}})}
 const factory=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;\n${src}\nreturn promote`)
 await assert.rejects(factory(deps)('box',{log:()=>{}}),e=>e.failedCount===1)
 assert.deepEqual(marked,['good'])
})
