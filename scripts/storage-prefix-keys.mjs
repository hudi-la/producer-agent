// 一次性:把 pursuit-files 桶里的旧 key 搬到 <owner>/… 下面。
//
//   node scripts/storage-prefix-keys.mjs          预演:打印一张「要搬什么」的表,一个字节不动
//   node scripts/storage-prefix-keys.mjs --yes    真搬
//
// 为什么要搬:0153 之后桶策略只认「路径第一段 = 自己的 uid」。0153 之前的文件
// 长这样:<pursuit>/<uuid>-<name>(附件)、box/<entry>/<ts>-<name>(盒子),
// 第一段不是人——策略一换,这些文件对它们的主人也立刻看不见、下不了。
// 这个脚本只在作者自己的生产库上跑一次;学员的新库从第一天起就是新 key。
//
// 连的是 brain/.env 里的 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY(service_role 绕过 RLS,
// 才能看见所有人的行)。读 producer.attachments / producer.works 要 PostgREST 露出 producer
// schema(README「上线连库」那一步已经开了)。
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

try {
  for (const line of readFileSync('brain/.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch (_) {}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('✗ brain/.env 里要有 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY'); process.exit(1)
}
const YES = process.argv.includes('--yes')
const BUCKET = 'pursuit-files'
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false }, db: { schema: 'producer' } })
const bucket = db.storage.from(BUCKET)
const die = (what, error) => { console.error(`✗ ${what}:${error.message}`); process.exit(1) }

// ── 一、桶里现在有什么。list 只列一层,文件夹的 id 是 null,自己往下走 ──
async function listAll(prefix = '') {
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(prefix, { limit: 1000, offset })
    if (error) die(`列 ${prefix || '/'}`, error)
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name
      if (e.id == null) out.push(...await listAll(path)); else out.push(path)
    }
    if (data.length < 1000) return out
  }
}

// ── 二、库里谁登记了哪把 key:附件在 attachments.storage_key,盒子在 works.box.files[].key ──
const att = await db.from('attachments').select('id, storage_key, owner')
if (att.error) die('读 attachments', att.error)
const works = await db.from('works').select('id, box, owner').not('box->files', 'is', null)
if (works.error) die('读 works', works.error)

const byKey = new Map()
for (const a of att.data) if (a.storage_key) byKey.set(a.storage_key, { kind: '附件', id: a.id, owner: a.owner })
for (const w of works.data) for (const f of w.box?.files ?? []) if (f.key) byKey.set(f.key, { kind: '盒子', id: w.id, owner: w.owner, work: w })
const owners = new Set([...byKey.values()].map((x) => x.owner).filter(Boolean))

// ── 三、分拣:已经在主人目录下的跳过;认得出主人的进计划;其余的只报不动 ──
const keys = await listAll()
const plan = [], skipped = []
for (const key of keys) {
  if (owners.has(key.split('/')[0])) continue                      // 已经搬过
  const hit = byKey.get(key)
  if (!hit) { skipped.push({ key, 原因: '桶里有、库里没登记(无主文件)' }); continue }
  if (!hit.owner) { skipped.push({ key, 原因: `登记在${hit.kind}上,但那行 owner 为空` }); continue }
  plan.push({ key, to: `${hit.owner}/${key}`, ...hit })
}
const inBucket = new Set(keys)
for (const [key, hit] of byKey) {
  if (!inBucket.has(key) && !owners.has(key.split('/')[0])) skipped.push({ key, 原因: `${hit.kind}登记了,桶里却没有(鬼文件)` })
}

console.log(`桶里 ${keys.length} 个对象;要搬 ${plan.length} 个;${keys.length - plan.length - skipped.filter((s) => inBucket.has(s.key)).length} 个已在主人目录下。`)
if (plan.length) console.table(plan.map((p) => ({ 从: p.key, 到: p.to, 登记在: `${p.kind} ${p.id}` })))
if (skipped.length) { console.log('\n不动的(要人看一眼):'); console.table(skipped) }
if (!YES) { console.log('\n这是预演,什么都没改。看过表没问题就加 --yes 真搬。'); process.exit(0) }

// ── 四、真搬:先挪字节,挪成了才改登记。反过来做,搬到一半断了就会有打不开的 key ──
let moved = 0
for (const p of plan) {
  const mv = await bucket.move(p.key, p.to)
  if (mv.error) { console.error(`✗ 搬不动 ${p.key}:${mv.error.message}`); continue }
  let r
  if (p.kind === '附件') {
    r = await db.from('attachments').update({ storage_key: p.to }).eq('id', p.id)
  } else {
    // 同一条 works 可能有好几个文件:就地改 work.box,后一次 update 带着前一次的结果
    p.work.box = { ...p.work.box, files: p.work.box.files.map((f) => (f.key === p.key ? { ...f, key: p.to } : f)) }
    r = await db.from('works').update({ box: p.work.box }).eq('id', p.id)
  }
  if (r.error) { console.error(`✗ 字节搬到了 ${p.to},但登记没改成:${r.error.message}(手工把 key 改过来)`); continue }
  moved++; console.log(`  ✓ ${p.key} → ${p.to}`)
}
console.log(`\n搬了 ${moved} / ${plan.length}。`)
