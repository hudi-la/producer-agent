import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordUsage, usageSummary } from './usage.js'
test('persists counters, includes Claude cache once, and isolates accounts', () => {
 const dir = mkdtempSync(join(tmpdir(), 'fw-usage-'))
 try {
  const a = join(dir,'a'), b = join(dir,'b'), now = new Date('2026-10-22T02:00:00Z')
  recordUsage(a,{provider:'claude-key',model:'c',usage:{inp:10,out:2,cacheRead:5,cacheWrite:3}},now)
  recordUsage(a,{provider:'openai',model:'g',usage:{inp:10,out:2,cacheRead:5}},now)
  recordUsage(a,{provider:'openai',model:'g',failed:true},now)
  const r = usageSummary(a,7,now).daily.at(-1).rows
  assert.equal(r[0].input,18);assert.equal(r[1].input,10);assert.equal(r[1].calls,2);assert.equal(r[1].measured,1);assert.equal(r[1].failed,1)
  assert.equal(usageSummary(b,7,now).daily.flatMap(d=>d.rows).length,0)
  assert.equal(usageSummary(a,7,new Date('2026-11-01')).daily.flatMap(d=>d.rows).length,0)
  writeFileSync(join(a,'usage.json'),'invalid');assert.throws(()=>recordUsage(a,{provider:'openai',model:'g'},now))
 } finally {rmSync(dir,{recursive:true,force:true})}
})
test('endpoint authenticates, validates periods and ignores supplied owners', async () => {
 const { withTenant } = await import('./tenant.js')
 const { handleHostedRoute } = await import('./hosted/routes.js')
 const dir = mkdtempSync(join(tmpdir(),'fw-usage-route-'))
 const call = async (tenant,url) => {
  const res = { setHeader(){}, writeHead(status){this.status=status},end(raw){this.body=JSON.parse(raw)} }
  await withTenant(tenant,()=>handleHostedRoute({method:'GET',url},res,{}));return res
 }
 try {
  assert.equal((await call(null,'/settings/usage')).status,401)
  const a={dataDir:join(dir,'a')},b={dataDir:join(dir,'b')}
  recordUsage(a.dataDir,{provider:'openai',model:'a-only',usage:{inp:10}})
  assert.equal((await call(b,'/settings/usage?owner=a')).body.daily.flatMap(d=>d.rows).length,0)
  assert.equal((await call(a,'/settings/usage?days=7')).body.daily.length,7)
  assert.equal((await call(a,'/settings/usage?days=999')).status,400)
 } finally { rmSync(dir,{recursive:true,force:true}) }
})
