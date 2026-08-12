// 「这是不是已经认识的某个人？」
//
// 判定那一层（classify.js）只问「这是谁」，没问「这是不是已经认识的谁」。
// 于是同一个人的第二个地址会各建一张卡——今天就撞了三次：
//   · Tom Leeser 的 .com 笔误（模型自己在备注里写了「疑似笔误」，还是建了新卡）
//   · Qi Zhang / QI / Qiqi，同一个人三种写法
//   · Luna 的私人 Gmail 和校友邮箱
//
// 而「粘个邮箱查」那条路（handleIdentify）**本来就有这个判断**：它把通讯录
// 喂给模型，让它认「他换邮箱了」。批量这条路漏了那一步。这个文件补上。
//
// 两条硬规矩，跟 handleIdentify 立的是同一条：
//   · 名字对得上、或者同一个机构同一件事在接着聊 → 算命中
//   · **名字像但机构和事情都对不上的不算** —— 那多半是两个人
//   · 拿不准就 low，low 的只报给你看，不自动并

import { db, myAccounts } from './store.js'
import { ask } from './ask.js'
import { adoptPerson } from './adopt.js'

const rpc = async (fn, args) => {
  const { data, error } = await db().rpc(fn, args)
  if (error) throw new Error(`${fn} 失败：${error.message}`)
  return data
}

const bookLine = (k) => {
  const emails = (k.emails || []).join('、') || (k.mailboxes || []).join('、') || '（无地址）'
  const orgs = (k.orgs || []).join('、') || k.org || ''
  return `- ${k.name}｜${emails}${orgs ? `｜${orgs}` : ''}`
}

/**
 * 待点头的那些地址里，哪些其实是通讯录里已有的某个人的另一个地址。
 * 高把握的直接并（认领 + 搬信到那张卡）；没把握的只报出来等你点。
 */
export async function mergePass({ apply = true, log = console.log } = {}) {
  const book = await rpc('pa_address_book_digest')
  const people = (book || []).filter((k) => (k.emails || []).length)
  if (!people.length) return { note: '通讯录是空的，没什么可对的' }

  const { data: rows, error } = await db().from('v_pa_greetable').select('*')
  if (error) throw new Error(error.message)
  if (!rows?.length) return { note: '没有等你点头的地址' }

  log(`拿 ${rows.length} 个待认地址跟通讯录里 ${people.length} 个人对一遍…`)

  const mine = new Set((await myAccounts()).map((a) => a.address))
  const cards = rows.filter((r) => !mine.has(r.email))

  const text = await ask(`下面是通讯录里已经认识的人，和一批还没入册的邮件地址。
挑出**其实是已认识的人的另一个地址**的那些。

【通讯录】
${people.map(bookLine).join('\n')}

【还没入册的地址】
${cards.map((r) => [
  `- ${r.email}`,
  r.name ? `  它认出的名字：${r.name}${r.org ? `（${r.org}）` : ''}` : '',
  r.why ? `  它写的：${r.why}` : '',
  `  往来：你发去 ${r.n_out} / 他发来 ${r.n_in}｜${r.first_at} → ${r.last_at}`,
  (r.subjects || []).length ? `  主题：${r.subjects.filter(Boolean).slice(0, 3).map((s) => `「${s}」`).join('　')}` : '',
].filter(Boolean).join('\n')).join('\n\n')}

判据（严格照这个来）：
· **名字对得上**，或者**同一个机构、同一件事在接着聊** → 算命中
· 常见情形：他换了工作邮箱、私人 Gmail 和机构邮箱并用、地址敲错了一个字母
· **名字像、但机构和事情都对不上的，不算**——那多半是两个人
· 一个地址只能命中一个人
· 没在通讯录里找到对应的人，就**根本不要列出来**

confidence 怎么给：
· high —— 名字一模一样，或者名字加机构/事情都对得上
· low  —— 看着像但说不死（只有姓氏相同、只有域名相同这种）

**最后一行**单独输出，别的什么都不要加：
[[MERGE]] {"merges":[{"email":"…","name":"通讯录里那个人的名字，原样抄","why":"一句话说清凭什么认定是同一个人","confidence":"high|low"}]}
一个都没有就输出 [[MERGE]] {"merges":[]}`)

  const m = text.match(/\[\[MERGE\]\]\s*(\{[\s\S]*\})\s*$/)
  let list = []
  try { list = m ? (JSON.parse(m[1]).merges || []) : [] } catch (_) { list = [] }
  if (!m) return { note: '它没按格式回话，这轮不动任何东西', raw: text.slice(-300) }

  // 名字 → 卡号。模型只会抄名字，卡号得我们自己查。
  const { data: contacts } = await db().from('v_pa_contacts').select('id, name')
  const byName = new Map((contacts || []).map((c) => [String(c.name || '').trim(), c.id]))

  const high = [], low = [], lost = []
  for (const x of list) {
    const email = String(x?.email || '').trim().toLowerCase()
    const cid = byName.get(String(x?.name || '').trim())
    if (!email || !cid) { lost.push(x); continue }
    ;(x.confidence === 'high' ? high : low).push({ ...x, email, contact_id: cid })
  }

  log(`  高把握 ${high.length} 个｜没把握 ${low.length} 个${lost.length ? `｜对不上卡号 ${lost.length} 个` : ''}`)

  const merged = []
  if (apply) {
    for (const h of high) {
      try {
        const out = await adoptPerson(h.email, {
          contactId: h.contact_id,
          notes: `${h.why}（自动并的，你可以在他名片上改）`,
          log: () => {},
        })
        merged.push({ ...h, promoted: out.promoted })
        log(`  ✓ ${h.email} → ${h.name}（搬了 ${out.promoted} 封）`)
      } catch (err) {
        log(`  ✗ ${h.email} → ${h.name} 没并成：${err.message}`)
      }
    }
  }

  // high 要把明细带回去，不能只报个数字。
  // 空跑的意义就是「让你先看它想并什么」——只说「1 个」等于什么都没说。
  return { checked: cards.length, high, low, merged, lost, applied: apply }
}
