import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { withTenant, tenant } from './tenant.js'
import { artifactRunsFor, artifactFields } from './artifacts.js'
import { boundMailReader } from './mail/search.js'
import { MailAuthError } from './mail/auth.js'

test('Gmail tools stay bound to their originating owner when invoked outside or in another context', async () => {
  const connect = async () => {
    const owner = tenant().owner
    return { users: { messages: { list: async () => ({data:{messages:[{id:owner}]}}), get: async () => ({data:{id:owner,payload:{headers:[]}}}) } } }
  }
  const [a,b] = await Promise.all(['A','B'].map(owner => withTenant({owner,marks:{}},()=>boundMailReader(connect))))
  const result = await withTenant({owner:'C',marks:{}},()=>Promise.all([a({query:'fixture'}),b({query:'fixture'})]))
  assert.deepEqual(result.map(r=>r.messages[0].id),['A','B'])
})
test('missing Gmail permission is returned by the tool without blocking creation of chat tools', async () => {
 const reader=await boundMailReader(async()=>{throw new MailAuthError('missing')})
 assert.equal((await reader({query:'fixture'})).needsAuth,true)
})
test('artifact materialization deduplicates one owner but never shares results across owners', async()=>{
 const source=readFileSync(new URL('./server.js',import.meta.url),'utf8')
 const handler=source.slice(source.indexOf('async function handleArtifact(body)'),source.indexOf('async function handleGmailDraft(body)'))
 const writes=[]
 const db={rpc:async(name,args)=>{writes.push(tenant().owner);return {data:{id:tenant().owner,...args}}}}
 const handle=new Function('tenant','artifactRunsFor','artifactFields','ownerOf','loadOwnerContext','db',handler+';return handleArtifact')(tenant,artifactRunsFor,artifactFields,b=>({kind:'contact',id:b.contact_id}),async()=>({raw:{deliverables:[]},msgs:[{id:'m',role:'producer',meta:{letter:{subject:'Fixture',body:'Text'}}}]}),db)
 const a={owner:'A',marks:{}},b={owner:'B',marks:{}}
 const [a1,a2,b1]=await Promise.all([withTenant(a,()=>handle({contact_id:'same',message_id:'m'})),withTenant(a,()=>handle({contact_id:'same',message_id:'m'})),withTenant(b,()=>handle({contact_id:'same',message_id:'m'}))])
 assert.equal(a1.id,'A');assert.equal(a2.id,'A');assert.equal(b1.id,'B');assert.deepEqual(writes.sort(),['A','B'])
 assert.equal(artifactRunsFor(a).size,0);assert.equal(artifactRunsFor(b).size,0)
})
test('artifact handler rejects messages outside the current conversation before writing', async()=>{
 const source=readFileSync(new URL('./server.js',import.meta.url),'utf8')
 const handler=source.slice(source.indexOf('async function handleArtifact(body)'),source.indexOf('async function handleGmailDraft(body)'))
 const handle=new Function('tenant','artifactRunsFor','artifactFields','ownerOf','loadOwnerContext','db',handler+';return handleArtifact')(tenant,artifactRunsFor,artifactFields,()=>({kind:'contact',id:'c'}),async()=>({raw:{deliverables:[]},msgs:[]}),{rpc:()=>assert.fail('must not write')})
 await withTenant({owner:'A',marks:{}},()=>assert.rejects(handle({message_id:'other'}),/没有/))
})
