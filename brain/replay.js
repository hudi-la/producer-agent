// 一次性：把 Fairwind 开工（2026-08-03）以来的往来，按时间序过一遍转移表。
//
// 跑法：cd brain && node --env-file=.env replay.js [--count]
//
//   --count  只数不判：多少条、多少个对象、预计多少次调用。
//
// ══ 规矩 ═══════════════════════════════════════════════════════
//
// · **按时间正序**，一条一条来 —— state 是按事件顺序重放的，
//   队列（pa_facts_to_judge）排好了序，每条判完 state 才走到下一格。
// · **只打标签，不起草** —— 起草归 server 的 timerPass，按到点日自然发生，
//   一轮最多 4 封。重放要是顺手起草，会一夜之间冒出几十封。
// · 判不出来（没按格式回话）的**留着不写标签**，下一轮再来；两轮都没进展
//   就停，把剩下的点名报出来 —— 静默截断是不许的。
//
// 设计稿：docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md 第十节

import { query } from '@anthropic-ai/claude-agent-sdk'
import { db } from './mail/store.js'
import { eventOf, parseTag, cellFor } from './judge.js'

// 跟 server.js 的 JUDGE_SYSTEM 同一段话（那份没 export —— server 顶层就
// listen，import 会占端口）。改一处要改两处，这脚本是一次性的，认了。
const JUDGE_SYSTEM = `你在读一段真实的邮件往来，替一位艺术家做一个很小的判断。

规矩：
- 只回答被问到的那几个问题，不展开、不建议、不客套。
- 依据只能是给你的这些文字。**看不出来就答 null**，不要推测。
- 最后一行按要求输出那个标记块，别的什么都不要加。`

async function think1(prompt) {
  const out = []
  for await (const m of query({
    prompt,
    options: {
      systemPrompt: JUDGE_SYSTEM, allowedTools: [],
      permissionMode: 'bypassPermissions', maxTurns: 1,
    },
  })) {
    if (m.type === 'assistant') {
      for (const b of m.message.content) if (b.type === 'text') out.push(b.text)
    }
    if (m.type === 'result' && m.subtype !== 'success') {
      throw new Error('没想完：' + m.subtype)
    }
  }
  return out.join('\n')
}

const rpc = async (fn, args) => {
  const { data, error } = await db().rpc(fn, args)
  if (error) throw new Error(`${fn} 失败：${error.message}`)
  return data
}

async function stateOf(kind, id) {
  const { data } = await db().from('v_pa_state').select('*')
    .eq('subject_kind', kind).eq('subject_id', id).maybeSingle()
  return data
}

const facts = (limit) => rpc('pa_facts_to_judge', { p_limit: limit })

async function count() {
  const rows = await facts(10000)
  const subjects = new Set(rows.map((r) => `${r.subject_kind}|${r.subject_id}`))
  console.log(`排队 ${rows.length} 条事实 / ${subjects.size} 个对象`)
  console.log(`按一条一次调用估：约 ${rows.length} 次 × ~$0.19 底价 ≈ $${(rows.length * 0.19).toFixed(0)}（订阅额度的等价额，不是账单）`)
  const byKind = {}
  for (const r of rows) byKind[`${r.kind}/${r.role}`] = (byKind[`${r.kind}/${r.role}`] || 0) + 1
  console.log('  构成：', JSON.stringify(byKind))
  return rows.length
}

async function replay() {
  let done = 0, spent = 0
  const stuck = new Map()      // id → 卡了几轮
  for (let round = 1; ; round++) {
    const batch = await facts(15)
    const fresh = batch.filter((f) => (stuck.get(f.id) || 0) < 2)
    if (!fresh.length) break
    let progressed = false
    for (const f of fresh) {
      const ev = eventOf(f)
      const st = await stateOf(f.subject_kind, f.subject_id)
      const stateName = st?.state || 'IDLE'
      const cell = cellFor(stateName, ev)
      const label = `${f.created_at?.slice(0, 10)} ${f.subject_name}｜${stateName} x ${ev}`
      if (!ev || !cell) {
        console.log(`  · 跳过（表里没这格）：${label}`)
        stuck.set(f.id, 9)
        continue
      }
      let tag = null
      if (cell.rule) tag = cell.rule(f)
      else {
        try { tag = parseTag(await think1(cell.ask(f, st))); spent++ }
        catch (err) { console.log(`  ✗ ${label}：${err.message}`); stuck.set(f.id, (stuck.get(f.id) || 0) + 1); continue }
      }
      if (!tag) {
        console.log(`  ✗ ${label}：没按格式回话`)
        stuck.set(f.id, (stuck.get(f.id) || 0) + 1)
        continue
      }
      const { error } = await db().rpc('pa_tag_message', {
        p_message_id: f.id, p_situation: `${stateName} x ${ev}`,
        p_resolves: tag.resolves, p_resolves_why: tag.resolves_why,
        p_needs_reply: tag.needs_reply, p_reply_why: tag.reply_why,
        p_awaiting: tag.awaiting, p_wait_days: tag.wait_days,
        p_meet_at: tag.meet_at, p_gist: tag.gist,
      })
      if (error) { console.log(`  ✗ ${label}：写标签失败 ${error.message}`); stuck.set(f.id, 9); continue }
      done++; progressed = true
      const 说 = tag.resolves ? `解决了（${tag.resolves_why}）`
        : tag.awaiting ? `等：${tag.awaiting}（${tag.wait_days} 天）`
        : tag.needs_reply ? `要回（${tag.reply_why}）`
        : tag.needs_reply === false ? '不用回'
        : tag.meet_at ? `约了 ${tag.meet_at}`
        : '（没起任何等待）'
      console.log(`  ✓ ${label} → ${说}`)
      // OWE_THANKS 判到「谢过了」要落到 intro_thanked_at（跟 server 的钩子一致）
      if (stateName === 'OWE_THANKS' && tag.resolves) {
        await rpc('pa_thank_introducer', { p_introducer: f.subject_id }).catch(() => {})
      }
    }
    if (!progressed) break
  }
  const left = (await facts(10000)).length
  console.log(`\n重放完：打了 ${done} 个标签，动了 ${spent} 次模型；还剩 ${left} 条没判成${left ? '（上面点过名）' : ''}`)
}

if (process.argv.includes('--count')) await count()
else { await count(); console.log(''); await replay() }
