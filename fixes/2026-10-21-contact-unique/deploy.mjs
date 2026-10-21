import pg from 'pg';
import {readFileSync} from 'node:fs';
if (!process.env.FAIRWIND_DATABASE_URL) throw Error('Set FAIRWIND_DATABASE_URL');
const db=new pg.Client({connectionString:process.env.FAIRWIND_DATABASE_URL});await db.connect();
const base=readFileSync(new URL('./baseline.sql',import.meta.url),'utf8');
const fix=readFileSync(new URL('./fix.sql',import.meta.url),'utf8');
const sig='public.pa_upsert_contact(uuid,text,text,text,text,text,jsonb,uuid,date,text,integer)';
try {
 await db.query('begin');await db.query("set local lock_timeout='3s'");
 const current=(await db.query('select pg_get_functiondef($1::regprocedure) as def',[sig])).rows[0].def;
 if(current!==base)throw Error('Function baseline changed');
 await db.query(fix);
 if(process.argv[2]==='apply'){
  await db.query('commit');console.log('Published function; no business records changed');
 }else{
  const owners=(await db.query('select id from auth.users order by created_at limit 2')).rows.map(x=>x.id);
  if(owners.length<2)throw Error('Need isolation fixtures');
  await db.query('set local role authenticated');
  const as=async id=>{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,role:'authenticated'})])};
  const assert=(v,m)=>{if(!v)throw Error(m)};
  const add=async(name,email,id=null)=>(await db.query('select * from public.pa_upsert_contact(p_id=>$1,p_name=>$2,p_email=>$3)',[id,name,email])).rows[0];
  await as(owners[0]);
  const email='contact-regression-'+Date.now()+'@example.invalid';
  const first=await add('Original',email);
  const again=await add('Must not overwrite','  '+email.toUpperCase()+'  ');
  assert(first.id===again.id && again.name==='Original','Repeat did not preserve contact');
  const second=await add('Other', 'other-'+email);
  await db.query('savepoint collision');
  try{await add('Changed',email,second.id);throw Error('Edit collision accepted')}catch(e){if(e.code!=='23505')throw e;await db.query('rollback to savepoint collision')}
  await as(owners[1]);
  assert((await db.query('select id from producer.contacts where id=$1',[first.id])).rowCount===0,'Cross-user read');
  const other=await add('Tenant B',email);assert(other.id!==first.id && other.owner===owners[1],'Cross-user reuse');
  await as(owners[0]);
  const noEmail=await add('No email',null);assert(!!noEmail.id,'Null email failed');
  await db.query('rollback');console.log('PASS: real authenticated inserts, case/space repeat, field preservation, edit collision, tenant isolation, no-email; all test writes rolled back');
 }
}catch(e){await db.query('rollback');throw e}finally{await db.end()}
