import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mailEvidence, bodyFallback } from './evidence.js'
async function harness(rows, full) {
  let src=await readFile(new URL('./adopt.js',import.meta.url),'utf8')
  src=src.replace(/^import .*$/gm,'').replace(/export /g,'')
  const writes=[],marked=[],prompts=[]
  const deps={mailEvidence,bodyFallback,gmailFor:()=>({}),getFull:full,plainText:p=>p?.text||'',authClient:async()=>({}),
    ask:async p=>{prompts.push(p);return '[[SUM]] {"s":["A grounded summary"]}'},toPromote:async()=>rows,
    markPromoted:async ids=>marked.push(...ids),db:()=>({rpc:async(name,args)=>{writes.push({name,args});return {data:{inserted:true}}}})}
  const promote=new Function('deps',`const {${Object.keys(deps)}}=deps;\n${src}\nreturn promote`)(deps)
  return {promote,writes,marked,prompts}
}
const row={gmail_message_id:'mail',direction:'out',counterpart_email:'person@example.org'}
for(const labels of [undefined,[],['DRAFT'],['DRAFT','SENT']]) test(`unconfirmed outgoing never summarized or archived: ${labels}`,async()=>{
 const h=await harness([row],async()=>({labelIds:labels,payload:{text:'Draft body'}}))
 await h.promote('person',{log:()=>{}})
 assert.equal(h.prompts.length,0);assert.equal(h.marked.length,0)
 assert.deepEqual(h.writes.map(w=>w.name),['pa_retract_unsent_mail'])
})
for(const code of [404,429,500])test(`read failure ${code} stays retryable, no invented summary`,async()=>{
 const h=await harness([row],async()=>{throw Object.assign(Error('failed'),{code})})
 await assert.rejects(h.promote('person',{log:()=>{}}),e=>e.failedCount===1)
 assert.equal(h.prompts.length,0);assert.equal(h.writes.length,0);assert.equal(h.marked.length,0)
})
test('empty parsed body gets factual fallback without model call',async()=>{
 const h=await harness([row],async()=>({labelIds:['SENT'],payload:{text:''}}))
 await h.promote('person',{log:()=>{}});assert.equal(h.prompts.length,0)
 assert.equal(h.writes[0].args.p_content,bodyFallback(''));assert.equal(h.writes[0].args.p_meta.body_status,'unavailable')
})
test('only readable verified messages reach summary; other failed message retries',async()=>{
 const h=await harness([row,{...row,gmail_message_id:'fail'}],async(_,id)=>{if(id==='fail')throw Error('network');return {labelIds:['SENT'],payload:{text:'A real request'}}})
 await assert.rejects(h.promote('person',{log:()=>{}}));assert.deepEqual(h.marked,['mail'])
 assert.equal(h.prompts.length,1);assert.match(h.prompts[0],/A real request/);assert.doesNotMatch(h.prompts[0],/正文是空的/)
})
test('archived incoming mail does not require SENT',()=>assert.equal(mailEvidence({},'in'),'verified'))

test('incremental metadata retracts a draft and still imports the actual sent version',async()=>{
 const {classify,mineSet,headerMap,parseAddr}=await import('./addr.js')
 const src=await readFile(new URL('./sync.js',import.meta.url),'utf8')
 const fn=src.slice(src.indexOf('async function toRows('),src.indexOf('\nasync function flush('))
 const calls=[]
 const deps={classify,mineSet,headerMap,parseAddr,mailEvidence,db:()=>({rpc:async(name,args)=>{calls.push(args);return {}}})}
 const toRows=new Function('d',`const {${Object.keys(deps)}}=d;${fn};return toRows`)(deps)
 const base={internalDate:'1792596960000',payload:{headers:[{name:'From',value:'me@example.org'},{name:'To',value:'other@example.org'}]}}
 const r=await toRows([{...base,id:'draft',labelIds:['DRAFT']},{...base,id:'sent',labelIds:['SENT']},{...base,id:'scheduled'}],'acct',mineSet(['me@example.org']))
 assert.deepEqual(r.rows.map(x=>x.gmail_message_id),['sent']);assert.equal(r.dropped,2)
 assert.deepEqual(calls.map(x=>x.p_reason),['draft','unverified_outgoing'])
 deps.db=()=>({rpc:async()=>({error:{message:'database unavailable'}})})
 const failing=new Function('d',`const {${Object.keys(deps)}}=d;${fn};return toRows`)(deps)
 await assert.rejects(failing([{...base,id:'draft',labelIds:['DRAFT']}],'acct',mineSet(['me@example.org'])),/database unavailable/)
})
