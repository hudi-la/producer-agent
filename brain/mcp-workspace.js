// User-owned workspace content. Writes use invoker RPCs and the request's tenant DB.
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
const id = z.uuid()
const str = z.string().trim().min(1)
const date = z.iso.date()
const json = z.record(z.string(), z.unknown())
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })
const stages = ['pending','matching','writing','sent','replying','won','paused','watch']
const card = {
 title: str, kind: z.string().optional(), org: z.string().optional(), location: z.string().optional(), funding: z.string().optional(),
 url: z.url().optional(), deadline: z.string().optional(), deadline_at: date.optional(), opens_at: date.optional(),
 eligible: z.boolean().optional(), match_stars: z.number().int().min(1).max(3).optional(), why: z.string().optional(), notes: z.string().optional(),
}
const entry = { id: id.optional(), kind: str, title: str, body: z.string().optional(), medium: z.string().optional(), year: z.string().optional(), meta: json.optional(), images: z.array(z.url()).optional(), site_path: z.string().optional(), draft: z.boolean().optional() }
const schedule = { enabled: z.boolean().optional(), prompt: str.optional(), run_every: z.enum(['manual','day','week']).optional(), run_weekday: z.number().int().min(0).max(6).optional(), run_hour: z.number().int().min(0).max(23).optional() }
const bounds = z.tuple([z.number().int().min(0),z.number().int().min(1)]).refine(([a,b]) => a<=b)
const field = z.object({ key: str, q: str, a: z.string().optional(), words: bounds.optional(), chars: bounds.optional() }).strict()
const rules = z.object({ words: bounds.optional(), chars: bounds.optional(), pages: z.number().int().positive().optional(), mb: z.number().positive().optional(), items: z.array(str).optional() }).strict()
const prefix = o => Object.fromEntries(Object.entries(o).map(([k,v])=>['p_'+k,v]))
export function registerWorkspaceTools(server, { db, rpc }) {
 const tool = (name, description, inputSchema, fn) => server.registerTool('fairwind_'+name, { description, inputSchema }, async a => {
  try { return text(await fn(a) ?? {ok:true}) } catch(e) { return {isError:true,content:[{type:'text',text:e.message}]} }
 })
 const list = (entity, filters={}, extra={}) => rpc('pa_mcp_list',{p_entity:entity,p_filters:filters,...prefix(extra)})
 const own = async (entity, rowId) => { const r=await list(entity,{id:rowId}); if(!r.rows.length) throw new Error('Record not found'); return r.rows[0] }
 const paging = { search:z.string().optional(), offset:z.number().int().min(0).optional(), limit:z.number().int().min(1).max(100).optional() }
 tool('stacks_list','列出独立卡片组。可搜索、分页；读取组内卡用 stack_get。',paging,a=>list('stacks',{},a))
 tool('stack_get','读取一个 stack 的信息和组内卡片，含顺序。',{id,...paging},async({id,...p})=>({stack:await own('stacks',id),cards:await list('cards',{stack_id:id},{limit:100,...p})}))
 tool('stack_create','创建独立 card stack，可同时加入新卡和已有卡。组名和卡标题/链接去重；已有卡不会挪出别组。最多100张，失败整批回滚。',{name:str,description:z.string().optional(),cards:z.array(z.object(card).strict()).max(100).optional(),pursuit_ids:z.array(id).max(100).optional()},({name,description,cards,pursuit_ids})=>rpc('pa_stack_write',{p_name:name,p_description:description??null,p_cards:cards??[],p_ids:pursuit_ids??[]}))
 tool('stack_set','修改 stack 名称或说明；未传入的保留。',{id,name:str.optional(),description:z.string().optional()},a=>rpc('pa_stack_write',prefix(a)))
 tool('stack_add','向已有 stack 加新卡或已有卡。若卡在别组，先明确移出再添加；重复添加不改变顺序。',{id,cards:z.array(z.object(card).strict()).max(100).optional(),pursuit_ids:z.array(id).max(100).optional()},({id,cards,pursuit_ids})=>rpc('pa_stack_write',{p_id:id,p_cards:cards??[],p_ids:pursuit_ids??[]}))
 tool('stack_remove','从组中移出指定卡片，保留卡片和所有内容。',{id,pursuit_ids:z.array(id).min(1).max(100)},({id,pursuit_ids})=>rpc('pa_stack_write',{p_id:id,p_ids:pursuit_ids,p_remove:true}))
 tool('stack_reorder','按给定顺序排列组内所有卡片，必须包括每张卡恰好一次。',{id,pursuit_ids:z.array(id).max(1000)},({id,pursuit_ids})=>rpc('pa_stack_write',{p_id:id,p_ids:pursuit_ids,p_reorder:true}))
 tool('pursuit_get','读一张卡的完整内容，包括匹配理由与备注。',{id},({id})=>own('pursuits',id))
 tool('pursuit_set','局部修改卡片，包括标题、机构、资助、理由、备注、阶段和小记；整次更新原子提交。',{id,...Object.fromEntries(Object.entries(card).map(([k,v])=>[k,v.optional()])),stage:z.enum(stages).optional(),jot:z.string().optional()},({id,...patch})=>rpc('pa_mcp_pursuit_set',{p_id:id,p_patch:patch}))
 tool('entries_import','批量导入档案（最多100条），同类同名跳过；传id才修改已有条目。失败整批回滚。',{entries:z.array(z.object(entry).strict()).min(1).max(100)},({entries})=>rpc('pa_mcp_entries_import',{p_entries:entries}))
 tool('entry_archive','归档或恢复档案。归档保留内容、从档案列表隐藏且不用于申请；恢复保留原草稿状态。',{id,archived:z.boolean()},a=>rpc('pa_mcp_entry_archive',prefix(a)))
 tool('entry_sort','设置档案条目的排序数值，数值小的排前面。',{id,sort:z.number().int()},({id,sort})=>rpc('pa_mcp_patch',{p_entity:'entry',p_id:id,p_patch:{sort}}))
 tool('entry_box_set','修改档案盒子的一项补充内容；value=null 删除该项。files 由附件上传维护。',{id,key:str.refine(v=>v!=='files','Use attachment_upload for files'),value:z.unknown()},a=>rpc('pa_set_entry_box_json',prefix(a)))
 tool('contacts_list','列联系人或按姓名/机构搜索。先查重，再新建。',paging,a=>list('contacts',{},a))
 tool('contact_set','新建或局部修改联系人。新增必填name；传id修改。邮箱重复时返回错误，先查联系人。',{id:id.optional(),name:str.optional(),email:z.email().optional(),org:z.string().optional(),role:z.string().optional(),notes:z.string().optional(),channels:z.array(json).optional(),intro_by:id.optional(),next_touch_at:date.optional(),next_touch_why:z.string().optional(),cadence_days:z.number().int().positive().optional()},async a=>{
  if(!a.id&&!a.name)throw new Error('New contacts require name')
  if(a.intro_by)await own('contacts',a.intro_by)
  if(a.email&&!a.id){const r=await list('contacts',{email:a.email});if(r.rows.length)throw new Error('Email already exists: '+r.rows[0].id)}
  return rpc('pa_upsert_contact',prefix(a))
 })
 tool('contact_note','记录联系人手记、电话或见面；可同时挂到一张机会卡，不发送消息。',{id,text:str,kind:z.enum(['note','meet']).optional(),pursuit_id:id.optional()},async({id,text,kind,pursuit_id})=>{
  await own('contacts',id);if(pursuit_id)await own('pursuits',pursuit_id)
  return rpc('pa_add_contact_message',{p_contact_id:id,p_role:'note',p_content:text,p_kind:kind??'note',p_pursuit_id:pursuit_id??null})
 })
 tool('notes_list','读取联系人或卡片下的手记/见面记录，需至少给一个对象。',{contact_id:id.optional(),pursuit_id:id.optional(),...paging},({contact_id,pursuit_id,...p})=>{if(!contact_id&&!pursuit_id)throw new Error('contact_id or pursuit_id required');return list('notes',{...(contact_id?{contact_id}:{}),...(pursuit_id?{pursuit_id}:{})},p)})
 tool('parties_list','读取某张卡关联的联系人和机构信箱。',{pursuit_id:id,...paging},({pursuit_id,...p})=>list('parties',{pursuit_id},p))
 tool('party_attach','把联系人或已登记的机构共享信箱关联到卡片，二选一。',{pursuit_id:id,contact_id:id.optional(),mailbox:z.email().optional(),note:z.string().optional()},async a=>{
  if(Boolean(a.contact_id)===Boolean(a.mailbox))throw new Error('Choose contact_id or mailbox')
  await own('pursuits',a.pursuit_id);if(a.contact_id)await own('contacts',a.contact_id)
  if(a.mailbox&&!(await list('mailboxes',{email:a.mailbox})).rows.length)throw new Error('Register mailbox first')
  return rpc('pa_attach_party',{...prefix(a),p_by:'you'})
 })
 tool('party_detach','解除卡片与联系人的关联，不删除联系人或邮件。',{id},async a=>{await own('parties',a.id);return rpc('pa_detach_party',prefix(a))})
 tool('mailboxes_list','列出机构共享信箱。',paging,a=>list('mailboxes',{},a))
 tool('mailbox_set','登记机构共享信箱，会按现有机制重新归属该地址往来。',{email:z.email(),org:str,label:z.string().optional(),notes:z.string().optional()},a=>rpc('pa_mark_org_mailbox',prefix(a)))
 tool('deliverables_list','读取一张卡下的申请材料、邮件草稿和表单，含正文和规则。',{pursuit_id:id,...paging},({pursuit_id,...p})=>list('deliverables',{pursuit_id},p))
 tool('deliverable_add','在卡片下存一份草稿。内容只存回Fairwind，不发送邮件或提交申请。',{pursuit_id:id,kind:z.enum(['idea','concept','statement','bio','email','file']),title:str,body:z.string().optional(),rules:rules.optional()},a=>rpc('pa_mcp_deliverable_add',prefix(a)))
 tool('deliverable_set','修改草稿标题、正文或规则。已定稿的材料不可覆盖。',{id,title:str.optional(),body:z.string().optional(),rules:rules.optional()},({id,...patch})=>rpc('pa_mcp_patch',{p_entity:'deliverable',p_id:id,p_patch:patch}))
 tool('form_save','把申请问题、字数要求与初稿答案存到卡片。同名草稿表合并，已有非空答案保留；逐题改答案用form_answer_set。',{pursuit_id:id,title:str,fields:z.array(field).min(1).max(100).refine(a=>new Set(a.map(f=>f.key)).size===a.length,'Duplicate field key')},async a=>{await own('pursuits',a.pursuit_id);return rpc('pa_adopt_form',prefix(a))})
 tool('form_answer_set','逐题更新申请答案，不影响其他答案。id为表单产出id，key来自其rules.fields。',{id,key:str,text:z.string()},async a=>{
  const d=await own('deliverables',a.id)
  if(d.status!=='draft'||d.kind!=='form'||!d.rules?.fields?.some(f=>f.key===a.key))throw new Error('Draft form field not found')
  return rpc('pa_set_answer',prefix(a))
 })
 tool('watchlist_set','局部更新机会池条目，不创建看板卡片。',{id,...Object.fromEntries(Object.entries(card).filter(([k])=>k!=='match_stars').map(([k,v])=>[k,v.optional()])),fit_stars:z.number().int().min(1).max(3).optional(),status:z.enum(['open','closed','unknown']).optional()},({id,...patch})=>rpc('pa_mcp_patch',{p_entity:'opportunity',p_id:id,p_patch:patch}))
 tool('watchlist_pick','把选中的机会池条目转成看板卡，重复调用返回原卡。',{id},async a=>{await own('opportunities',a.id);return rpc('pa_pick_opportunity',prefix(a))})
 tool('watchlist_drop','标记机会不再关注，或恢复关注；保留原记录。',{id,dropped:z.boolean(),why:z.string().optional()},async({id,dropped,why})=>{await own('opportunities',id);return rpc(dropped?'pa_drop_opportunity':'pa_undrop_opportunity',{p_id:id,...(dropped?{p_why:why??null}:{})})})
 tool('tasks_list','读取用户的搜寻任务、提示词与排期。',paging,a=>list('tasks',{},a))
 tool('task_add','创建搜寻任务，默认停用、手动运行；排期使用个人档案时区。',{name:str,...schedule,prompt:str},a=>rpc('pa_mcp_task_add',prefix(a)))
 tool('task_set','修改搜寻要求、启停和排期。run_every=manual取消自动排期；使用个人档案时区。',{id,...schedule},async a=>{await own('tasks',a.id);return rpc('pa_set_task',prefix(a))})
 tool('task_run','立即排队运行一次已有搜寻任务。',{id},async a=>{const t=await own('tasks',a.id);if(!t.prompt)throw new Error('Task has no search prompt');await rpc('pa_run_task_now',prefix(a));return{ok:true,queued:true}})
 tool('attachments_list','列卡片附件或档案条目的材料文件，二选一。',{pursuit_id:id.optional(),entry_id:id.optional(),...paging},async({pursuit_id,entry_id,...p})=>{
  if(Boolean(pursuit_id)===Boolean(entry_id))throw new Error('Choose pursuit_id or entry_id')
  if(entry_id)return {rows:(await own('entries',entry_id)).box?.files??[]}
  return list('attachments',{pursuit_id},p)
 })
 tool('attachment_upload','上传真实文件到卡片或档案，二选一。content_base64为文件的标准Base64，单文件最多8MiB；不接收本地路径或远程URL。',{pursuit_id:id.optional(),entry_id:id.optional(),filename:str.max(200),mime:str.max(150),content_base64:z.string().min(4).max(11184812)},async a=>{
  if(Boolean(a.pursuit_id)===Boolean(a.entry_id))throw new Error('Choose pursuit_id or entry_id')
  await own(a.entry_id?'entries':'pursuits',a.entry_id??a.pursuit_id)
  const bytes=Buffer.from(a.content_base64,'base64');if(!bytes.length||bytes.length>8*1024*1024||bytes.toString('base64')!==a.content_base64)throw new Error('Invalid Base64 or file exceeds 8MiB')
  const {data,error}=await db.auth.getUser();if(error||!data?.user?.id)throw new Error('Authenticated user required')
  const filename=a.filename.replaceAll('\\','/').split('/').pop();if(!filename)throw new Error('Filename required')
  const key=`${data.user.id}/${a.entry_id??a.pursuit_id}/${randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g,'-')}`
  const bucket=db.storage.from('pursuit-files');const up=await bucket.upload(key,bytes,{contentType:a.mime,upsert:false});if(up.error)throw new Error(up.error.message)
  try {
   let result
   if(a.entry_id){await rpc('pa_mcp_entry_file',{p_id:a.entry_id,p_file:{name:filename,key,size:bytes.length,type:a.mime,at:new Date().toISOString()}});result={entry_id:a.entry_id,key}}
   else result={id:await rpc('pa_add_attachment',{p_pursuit_id:a.pursuit_id,p_filename:filename,p_storage_key:key,p_mime:a.mime,p_bytes:bytes.length})}
   return {ok:true,...result,filename,bytes:bytes.length}
  }catch(e){const cleanup=await bucket.remove([key]);if(cleanup.error)throw new Error(`${e.message}; cleanup failed: ${cleanup.error.message}`);throw e}
 })
 tool('attachment_url','为已登记附件生成临时下载链接；卡片传id，档案传entry_id和key。',{id:id.optional(),entry_id:id.optional(),key:z.string().optional()},async a=>{
  let key
  if(a.id&&!a.entry_id&&!a.key)key=(await own('attachments',a.id)).storage_key
  else if(a.entry_id&&a.key&&!a.id){const e=await own('entries',a.entry_id);key=e.box?.files?.find(f=>f.key===a.key)?.key}
  if(!key)throw new Error('Registered file not found')
  const {data,error}=await db.storage.from('pursuit-files').createSignedUrl(key,300);if(error)throw new Error(error.message);return data
 })
}
