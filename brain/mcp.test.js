// 用官方 client 走一遍 Streamable HTTP:列工具、加一条、列出来、改一条、挂图。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser, assumeUser } from './local/migrate.js'
import { makeLocalDb } from './local/localdb.js'
import { handleMcp } from './mcp.js'

const UID = '11111111-1111-4111-8111-111111111111'
let dir, pg, srv, client, port
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fw-mcp-'))
  pg = await openLocalDb(dir); await applyMigrations(pg, { fresh: true }).catch(e => { console.error(e.message); throw e }); await setLocalUid(pg, UID); await registerLocalUser(pg, { id: UID, email: 'a@b.c' }); await assumeUser(pg)
  const db = await makeLocalDb({ pg, dataDir: dir, user: { id: UID, email: 'a@b.c' } })
  srv = http.createServer((req, res) => handleMcp(req, res, { db, version: '9.9.9', dataDir: dir, modules: { profile: true, pursuits: true, mail: true }, previewJudgments: async ({ limit }) => ({ rows: [], n: 0, changed: 0, limit }) }))
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); port = srv.address().port
  client = new Client({ name: 'test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)))
})
after(async () => { await client?.close().catch(() => {}); srv?.close(); await pg?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })

const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); const t = r.content?.[0]?.text || ''; return { r, t, j: (() => { try { return JSON.parse(t) } catch { return null } })() } }

test('列工具:档案六个 + 机会卡四个 + 判据三个 + 关注表两个', async () => {
  const { tools } = await client.listTools()
  const original = ['fairwind_entries_list', 'fairwind_entry_add', 'fairwind_entry_set', 'fairwind_info', 'fairwind_judgments_list', 'fairwind_judgments_preview', 'fairwind_judgments_write', 'fairwind_profile_get', 'fairwind_profile_set', 'fairwind_pursuit_add', 'fairwind_pursuit_note', 'fairwind_pursuit_set', 'fairwind_pursuits_list', 'fairwind_watchlist_add', 'fairwind_watchlist_list']
  assert.deepEqual(tools.map((t) => t.name).filter(n => original.includes(n)).sort(), ['fairwind_entries_list', 'fairwind_entry_add', 'fairwind_entry_set', 'fairwind_info', 'fairwind_judgments_list', 'fairwind_judgments_preview', 'fairwind_judgments_write', 'fairwind_profile_get', 'fairwind_profile_set', 'fairwind_pursuit_add', 'fairwind_pursuit_note', 'fairwind_pursuit_set', 'fairwind_pursuits_list', 'fairwind_watchlist_add', 'fairwind_watchlist_list'])
})

test('info 说版本和判据目录;profile 改了读得回', async () => {
  const i = await call('fairwind_info'); assert.equal(i.j.version, '9.9.9'); assert.ok(i.j.judgmentsDir.endsWith('/judgments'))
  await call('fairwind_profile_set', { name: '测试人', website: 'https://x.art', location: ['LA', 'SF'] })
  const p = await call('fairwind_profile_get'); assert.equal(p.j.name, '测试人'); assert.deepEqual(p.j.data.location, ['LA', 'SF'])
})

test('加一条作品带图 → 列出来 → 改标题和草稿 → 再列', async () => {
  const a = await call('fairwind_entry_add', { kind: 'work', title: '回声', medium: '装置', year: '2025', body: '一句话', images: ['https://x.art/a.jpg'], site_path: '/work/echo' })
  assert.equal(a.j.ok, true); assert.ok(a.j.id)
  let l = await call('fairwind_entries_list', { kind: 'work' }); assert.equal(l.j.length, 1); assert.equal(l.j[0].title, '回声'); assert.deepEqual(l.j[0].images, ['https://x.art/a.jpg']); assert.equal(l.j[0].site_path, '/work/echo')
  await call('fairwind_entry_set', { id: a.j.id, title: '回声（改）', draft: true })
  l = await call('fairwind_entries_list'); assert.equal(l.j[0].title, '回声（改）'); assert.equal(l.j[0].draft, true)
  const bad = await call('fairwind_entry_set', { id: '00000000-0000-4000-8000-000000000000', title: 'x' }); assert.equal(bad.r.isError, true)
})

test('自定义类目:kind 随便起,meta 随便放,列出来原样', async () => {
  const a = await call('fairwind_entry_add', { kind: '驻地日志', title: '2025 秋 · 某某驻地', meta: { 待了多久: '六周', 做了什么: '两件新作' } })
  assert.equal(a.j.ok, true)
  const l = await call('fairwind_entries_list', { kind: '驻地日志' }); assert.equal(l.j.length, 1); assert.equal(l.j[0].meta.待了多久, '六周')
})

test('机会卡:加 → 列 → 挪阶段/写小记 → 记一笔', async () => {
  const a = await call('fairwind_pursuit_add', { title: 'Some Open Call 2026', kind: '开放征集', org: 'X Center', deadline: 'Oct 1, 2026', deadline_at: '2026-10-01', url: 'https://x.org/call', match_stars: 3, why: '装置对味' })
  assert.equal(a.j.ok, true, a.t)
  let l = await call('fairwind_pursuits_list'); assert.equal(l.j.length, 1); assert.equal(l.j[0].stage, 'pending'); assert.equal(l.j[0].deadline_at, '2026-10-01')
  const id = l.j[0].id
  const s = await call('fairwind_pursuit_set', { id, stage: 'matching', jot: '先看往届' }); assert.equal(s.j.ok, true, s.t)
  l = await call('fairwind_pursuits_list', { stage: 'matching' }); assert.equal(l.j.length, 1); assert.equal(l.j[0].jot, '先看往届')
  const n = await call('fairwind_pursuit_note', { id, text: '给策展人打了电话', kind: 'note' }); assert.equal(n.j.ok, true, n.t)
})

test('判据:写 → 读回;不许的文件名拒;lint 点名;preview 通到 brain', async () => {
  const w = await call('fairwind_judgments_write', { file: '对方来信.md', content: '投递类我等 30 天\n删掉 gist' })
  assert.equal(w.j.ok, true); assert.equal(w.j.lints.length, 1)
  const l = await call('fairwind_judgments_list'); assert.match(l.j.files['对方来信.md'], /30 天/); assert.equal(l.j.files['手记.md'], '')
  const bad = await call('fairwind_judgments_write', { file: '../settings.json', content: 'x' }); assert.equal(bad.r.isError, true)
  const p = await call('fairwind_judgments_preview', { limit: 3 }); assert.equal(p.j.limit, 3)
})

test('这扇门加的条目默认算写完(draft=false);明说 draft:true 才是在写', async () => {
  await call('fairwind_entry_add', { kind: 'work', title: '默认写完' })
  await call('fairwind_entry_add', { kind: 'work', title: '明说在写', draft: true })
  const rows = (await call('fairwind_entries_list', { kind: 'work' })).j
  const byTitle = Object.fromEntries(rows.map((r) => [r.title, r.draft]))
  assert.equal(byTitle['默认写完'], false); assert.equal(byTitle['明说在写'], true)
})

test('机会线模块没开:机会卡的工具照样在,加卡进库并提示去开模块', async () => {
  const db2 = await makeLocalDb({ pg, dataDir: dir, user: { id: UID, email: 'a@b.c' } })
  const srv2 = http.createServer((req, res) => handleMcp(req, res, { db: db2, version: '9.9.9', dataDir: dir, modules: { profile: true, pursuits: false, mail: false } }))
  await new Promise((ok) => srv2.listen(0, '127.0.0.1', ok))
  const c2 = new Client({ name: 't2', version: '1' }); await c2.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv2.address().port}/mcp`)))
  const { tools } = await c2.listTools()
  assert.ok(tools.some((t) => t.name === 'fairwind_pursuit_add') && tools.some((t) => t.name === 'fairwind_pursuits_list'), '模块关着也列得到机会卡工具')
  assert.ok(!tools.some((t) => t.name === 'fairwind_judgments_write'), '判据仍跟邮件走')
  const r = await c2.callTool({ name: 'fairwind_pursuit_add', arguments: { title: '模块没开时加的' } })
  const j = JSON.parse(r.content[0].text); assert.equal(j.ok, true); assert.match(j.note || '', /机会线模块还没开/)
  const rows = JSON.parse((await c2.callTool({ name: 'fairwind_pursuits_list', arguments: {} })).content[0].text)
  assert.ok(rows.some((x) => x.title === '模块没开时加的'))
  await c2.close(); srv2.close()
})


test('关注表:关闭与资格搁置保留，重复只补空，不生成卡', async () => {
  const before = (await call('fairwind_pursuits_list')).j.length
  const args = { title: 'Watch Residency', url: 'https://example.org/residency', status: 'closed', eligible: false, fit_stars: 3, opens_at: '2027-03-01', notes: '🟡 Watch · Next round expected March. Eligibility pending; CV + portfolio required.' }
  const added = await call('fairwind_watchlist_add', args)
  assert.equal(added.j?.created, true, added.t)
  const duplicate = await call('fairwind_watchlist_add', { ...args, title: ' WATCH RESIDENCY ', eligible: true, status: 'open', funding: '$2000', notes: 'must not overwrite' })
  assert.equal(duplicate.j?.created, false, duplicate.t)
  assert.equal(duplicate.j.id, added.j.id)
  const urlDuplicate = await call('fairwind_watchlist_add', { ...args, title: 'Another title', url: args.url + '/' })
  assert.equal(urlDuplicate.j.id, added.j.id)
  const rows = (await call('fairwind_watchlist_list', { eligible: false, status: 'closed' })).j
  const row = rows.find((r) => r.id === added.j.id)
  assert.equal(row.opens_at, '2027-03-01'); assert.equal(row.notes, args.notes)
  assert.equal(row.funding, '$2000'); assert.equal(row.pursuit_id, null)
  assert.equal((await call('fairwind_pursuits_list')).j.length, before)
})

test('关注表:已有卡跳过；无效日期、空标题、无效状态拒绝', async () => {
  const existing = await call('fairwind_watchlist_add', { title: ' SOME OPEN CALL 2026 ', status: 'open', eligible: true })
  assert.equal(existing.j?.skipped, 'already_on_board', existing.t)
  for (const patch of [{ title: ' ' }, { deadline_at: '2026-02-30' }, { status: 'maybe' }]) {
    const bad = await call('fairwind_watchlist_add', { title: 'Invalid watch row', status: 'open', eligible: true, ...patch })
    assert.equal(bad.r.isError, true)
  }
  assert.ok(!(await call('fairwind_watchlist_list')).j.some((r) => r.title === 'Invalid watch row'))
})

const good = async(name,args={})=>{const out=await call(name,args);assert.notEqual(out.r.isError,true,out.t);return out.j}
let stackId, cardId, contactId, entryId, formId, fileId

test('workspace tool inventory and timezone validation',async()=>{
 const {tools}=await client.listTools()
 for(const name of ['stack_create','stack_get','contacts_list','contact_set','form_save','attachment_upload','tasks_list','watchlist_set','entry_archive'])assert.ok(tools.some(t=>t.name==='fairwind_'+name),name)
 await good('fairwind_profile_set',{tz:'Asia/Shanghai'})
 assert.equal((await good('fairwind_profile_get')).data.tz,'Asia/Shanghai')
 assert.equal((await call('fairwind_profile_set',{tz:'Not/AZone'})).r.isError,true)
})
test('independent stack: create, deduplicate, order, remove, rename, atomic rollback',async()=>{
 const s=await good('fairwind_stack_create',{name:'My stack',cards:[{title:'Stack card A'},{title:'Stack card B'}]});stackId=s.id;cardId=s.cards[0].id
 const duplicate=await good('fairwind_stack_create',{name:' My stack ',cards:[{title:'Stack card A'}]});assert.equal(duplicate.id,stackId)
 let read=await good('fairwind_stack_get',{id:stackId});assert.equal(read.cards.rows.length,2);assert.equal(read.cards.rows[0].id,cardId)
 const ids=read.cards.rows.map(x=>x.id).reverse();await good('fairwind_stack_reorder',{id:stackId,pursuit_ids:ids})
 read=await good('fairwind_stack_get',{id:stackId});assert.deepEqual(read.cards.rows.map(x=>x.id),ids)
 assert.equal((await call('fairwind_stack_reorder',{id:stackId,pursuit_ids:[cardId]})).r.isError,true)
 const bad=await call('fairwind_stack_add',{id:stackId,cards:[{title:'Must roll back'}],pursuit_ids:['00000000-0000-4000-8000-000000000000']});assert.equal(bad.r.isError,true)
 assert.ok(!(await good('fairwind_pursuits_list')).some(x=>x.title==='Must roll back'))
 await good('fairwind_stack_remove',{id:stackId,pursuit_ids:[cardId]});assert.equal((await good('fairwind_pursuit_get',{id:cardId})).id,cardId)
 await good('fairwind_stack_add',{id:stackId,pursuit_ids:[cardId]});await good('fairwind_stack_set',{id:stackId,name:'Renamed'})
 assert.equal((await good('fairwind_stack_get',{id:stackId})).stack.name,'Renamed')
 const other=await call('fairwind_stack_create',{name:'Should roll back too',pursuit_ids:[cardId]});assert.equal(other.r.isError,true)
 assert.equal((await good('fairwind_stacks_list',{search:'Should roll back too'})).rows.length,0)
})
test('complete card patch preserves other fields and rejects invalid dates',async()=>{
 await good('fairwind_pursuit_set',{id:cardId,org:'A gallery',funding:'$2000',why:'Relevant work',stage:'writing',jot:'Prepare proposal'})
 const p=await good('fairwind_pursuit_get',{id:cardId});assert.equal(p.org,'A gallery');assert.equal(p.why,'Relevant work');assert.equal(p.title,'Stack card A')
 assert.equal((await call('fairwind_pursuit_set',{id:cardId,deadline_at:'2026-02-30'})).r.isError,true)
 const r=await pg.query("select public.pa_mcp_pursuit_set($1,$2)",[cardId,{org:'Must rollback',stage:'invalid'}]).catch(e=>e);assert.ok(r instanceof Error)
 assert.equal((await good('fairwind_pursuit_get',{id:cardId})).org,'A gallery')
})
test('contacts, linked meeting records, parties and search pagination',async()=>{
 const c=await good('fairwind_contact_set',{name:'MCP curator',email:'mcp-curator@example.org',org:'A gallery'});contactId=c.id
 await good('fairwind_contact_set',{id:contactId,role:'Curator'})
 const rows=(await good('fairwind_contacts_list',{search:'MCP curator',limit:1})).rows;assert.equal(rows[0].role,'Curator');assert.equal(rows[0].org,'A gallery')
 await good('fairwind_contact_note',{id:contactId,text:'Discussed the exhibition',kind:'meet',pursuit_id:cardId})
 assert.ok((await good('fairwind_notes_list',{contact_id:contactId})).rows.some(x=>x.content==='Discussed the exhibition'))
 await good('fairwind_party_attach',{pursuit_id:cardId,contact_id:contactId})
 assert.equal((await good('fairwind_parties_list',{pursuit_id:cardId})).rows[0].contact_id,contactId)
})
test('batch entries, box, sorting, archival and restoration',async()=>{
 const r=await good('fairwind_entries_import',{entries:[{kind:'work',title:'MCP artwork',body:'Original',draft:false,meta:{year:'2026'}}]});entryId=r[0].id
 const dup=await good('fairwind_entries_import',{entries:[{kind:'work',title:'MCP artwork',body:'Must not replace'}]});assert.equal(dup[0].skipped,'existing')
 await good('fairwind_entry_box_set',{id:entryId,key:'context',value:{why:'Now'}})
 await good('fairwind_entry_sort',{id:entryId,sort:2});await good('fairwind_entry_archive',{id:entryId,archived:true})
 let e=(await good('fairwind_entries_list')).find(x=>x.id===entryId);assert.equal(e.draft,true);assert.equal(e.meta.mcp_archived,true);assert.equal(e.body,'Original');assert.equal(e.box.context.why,'Now')
 await good('fairwind_entry_archive',{id:entryId,archived:false});e=(await good('fairwind_entries_list')).find(x=>x.id===entryId);assert.equal(e.draft,false);assert.equal(e.sort,2)
 const bad=await call('fairwind_entries_import',{entries:[{kind:'work',title:'Atomic entry'},{id:'00000000-0000-4000-8000-000000000000',kind:'work',title:'Missing'}]});assert.equal(bad.r.isError,true)
 assert.ok(!(await good('fairwind_entries_list')).some(x=>x.title==='Atomic entry'))
})
test('draft materials, final protection and field-by-field form answers',async()=>{
 const d=await good('fairwind_deliverable_add',{pursuit_id:cardId,kind:'statement',title:'Statement',body:'First draft',rules:{words:[0,300]}})
 await good('fairwind_deliverable_set',{id:d.id,body:'Revised'})
 assert.equal((await good('fairwind_deliverables_list',{pursuit_id:cardId})).rows.find(x=>x.id===d.id).body,'Revised')
 await pg.query("update producer.deliverables set status='final' where id=$1",[d.id]);assert.equal((await call('fairwind_deliverable_set',{id:d.id,body:'Forbidden'})).r.isError,true)
 const f=await good('fairwind_form_save',{pursuit_id:cardId,title:'Application',fields:[{key:'bio',q:'Biography',words:[0,100],a:'Original bio'},{key:'project',q:'Project',a:'Original project'}]});formId=f.id
 await good('fairwind_form_answer_set',{id:f.id,key:'bio',text:'Updated bio'})
 let saved=(await good('fairwind_deliverables_list',{pursuit_id:cardId})).rows.find(x=>x.id===f.id)
 assert.equal(saved.meta.answers.project,'Original project');assert.equal(saved.meta.answers.bio,'Updated bio')
 assert.equal((await call('fairwind_form_answer_set',{id:f.id,key:'unknown',text:'x'})).r.isError,true)
 await good('fairwind_form_save',{pursuit_id:cardId,title:'Application',fields:[{key:'bio',q:'Biography',a:'Must preserve'},{key:'project',q:'Project'}]})
 saved=(await good('fairwind_deliverables_list',{pursuit_id:cardId})).rows.find(x=>x.id===f.id);assert.equal(saved.meta.answers.bio,'Updated bio')
})
test('file bytes uploaded before registration, both card and entry files readable',async()=>{
 const a=await good('fairwind_attachment_upload',{pursuit_id:cardId,filename:'Résumé.pdf',mime:'application/pdf',content_base64:Buffer.from('%PDF-test').toString('base64')});fileId=typeof a.id==='object'?a.id.id:a.id
 const rows=(await good('fairwind_attachments_list',{pursuit_id:cardId})).rows;assert.equal(rows.length,1);assert.equal(rows[0].bytes,9);assert.ok(rows[0].storage_key.startsWith(UID+'/'))
 assert.ok((await good('fairwind_attachment_url',{id:rows[0].id})).signedUrl)
 const f=await good('fairwind_attachment_upload',{entry_id:entryId,filename:'image.png',mime:'image/png',content_base64:Buffer.from('image').toString('base64')})
 assert.equal((await good('fairwind_attachments_list',{entry_id:entryId})).rows[0].name,'image.png')
 assert.ok((await good('fairwind_attachment_url',{entry_id:entryId,key:f.key})).signedUrl)
 assert.equal((await call('fairwind_attachment_url',{entry_id:entryId,key:'other/file'})).r.isError,true)
 assert.equal((await call('fairwind_attachment_upload',{pursuit_id:cardId,filename:'bad',mime:'text/plain',content_base64:'!!!!'})).r.isError,true)
})
test('watchlist edit/pick/drop/restore and task lifecycle',async()=>{
 const o=await good('fairwind_watchlist_add',{title:'MCP pool edit',status:'unknown',eligible:true});await good('fairwind_watchlist_set',{id:o.id,status:'open',funding:'Fee waived'})
 let row=(await good('fairwind_watchlist_list')).find(x=>x.id===o.id);assert.equal(row.funding,'Fee waived')
 await good('fairwind_watchlist_drop',{id:o.id,dropped:true,why:'Later'});await good('fairwind_watchlist_drop',{id:o.id,dropped:false})
 const picked=await good('fairwind_watchlist_pick',{id:o.id});assert.ok(picked)
 const t=await good('fairwind_task_add',{name:'My search',prompt:'Find sculpture calls'});assert.equal(t.enabled,false)
 await good('fairwind_task_set',{id:t.id,enabled:true,run_every:'week',run_weekday:2,run_hour:9})
 await good('fairwind_task_run',{id:t.id});row=(await good('fairwind_tasks_list',{search:'My search'})).rows[0];assert.equal(row.run_now,true);assert.equal(row.run_every,'week')
})
test('two owners: tools cannot read, attach, upload or update another owner data',async()=>{
 const other='22222222-2222-4222-8222-222222222222';await registerLocalUser(pg,{id:other,email:'b@example.org'});await setLocalUid(pg,other)
 try{
  assert.equal((await good('fairwind_stacks_list')).rows.length,0)
  for(const [name,args] of [
   ['stack_get',{id:stackId}],['stack_add',{id:stackId,pursuit_ids:[cardId]}],['pursuit_set',{id:cardId,title:'Stolen'}],['contact_set',{id:contactId,name:'Stolen'}],['contact_note',{id:contactId,text:'Stolen'}],['entry_archive',{id:entryId,archived:true}],['form_answer_set',{id:formId,key:'bio',text:'Stolen'}],['attachment_url',{id:fileId}],['attachment_upload',{pursuit_id:cardId,filename:'bad.txt',mime:'text/plain',content_base64:'YWJj'}]
  ])assert.equal((await call('fairwind_'+name,args)).r.isError,true,name)
  const denied=await call('fairwind_stack_create',{name:'Foreign card',pursuit_ids:[cardId]});assert.equal(denied.r.isError,true)
  assert.equal((await good('fairwind_stacks_list')).rows.length,0)
 }finally{await setLocalUid(pg,UID)}
 assert.equal((await good('fairwind_pursuit_get',{id:cardId})).title,'Stack card A')
})
