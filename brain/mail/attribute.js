// 判断层：机械层接不住的那些来信，是哪条线的事。
//
// ══ 谁会落到这儿 ═══════════════════════════════════════════════
//
// 机械层（pa_link_replies）靠 RFC 的 References/In-Reply-To 认亲，能盖住
// 「对方点回复」的绝大多数。落到这儿的是另一种：
//
//   你发给 info@pam.usc.edu，Cristina 用 ch45852@usc.edu **另起一封新信**
//   回你，主题写着 "Workshop Proposal for Workshops@PAM"。
//
// 既不同人、又不同串，只有主题和机构能看出关系。所以这一步要模型。
//
// ══ 只问该问的 ═════════════════════════════════════════════════
//
// 不是拿所有孤儿信去问。只问**最近来的、判定是真人或机构信箱、跟业务
// 相关、而且还没落在任何一条线上**的那些。绝大多数轮次这个集合是空的，
// 一次模型调用都不用花。

import { db } from './store.js'
import { ask } from './ask.js'

const rpc = async (fn, args) => {
  const { data, error } = await db().rpc(fn, args)
  if (error) throw new Error(`${fn} 失败：${error.message}`)
  return data
}

/** 还没落到任何一条线上的近期来信，按地址收拢。 */
// **方向不限。** 旧的 pa_orphan_inbound 第一个条件是 direction='in' ——
// 于是「我主动发出去的冷邮件」在被回信之前，归属这一步完全看不见它。
// 而那恰恰是最该建线的一种：投递、自荐、经人介绍去问一句。
// 真例：8/19 发给 adavi290@asu.edu 的那封（Biayna 介绍的人），
// 系统判出「真人 · 正事」之后，就把它扔在账本里了。
async function orphans(days) {
  const { data, error } = await db().rpc('pa_orphan_mail', { p_days: days })
  if (error) throw new Error('读孤儿来信失败：' + error.message)
  return data || []
}

export async function attributePass({ days = 30, apply = true, log = console.log } = {}) {
  const rows = await orphans(days)
  if (!rows.length) return { checked: 0, note: '最近没有无处安放的往来' }

  const { data: pursuits, error } = await db()
    .from('v_pa_pursuits').select('id, title, org, stage')
    .in('stage', ['sent', 'replying', 'won', 'matching', 'writing', 'paused'])
  if (error) throw new Error(error.message)
  if (!pursuits?.length) return { checked: rows.length, note: '没有在跑的线可挂' }

  log(`${rows.length} 个地址的往来还没落到任何线上，跟 ${pursuits.length} 条线对一遍…`)

  const text = await ask(`下面是一些**还没归到任何机会线**的往来，和你现在在跑的机会线。
判断每一个地址是不是某条线的事。

**注意方向**：有的是他发给你的，有的是**你主动发出去、还没等到回信**的
（下面会标 in / out 的封数）。后一种同样该归线 —— 冷邮件、投递、经人介绍
去问一句，都是从你发出的那一封开始的。

【在跑的机会线】
${pursuits.map((p) => `- [${p.id.slice(0, 8)}] ${p.title}｜机构：${p.org || '（没写）'}`).join('\n')}

【无处安放的往来】
${rows.map((r) => [
  `- ${r.email}${r.name ? `（${r.name}）` : ''}`,
  r.why ? `  这个人：${r.why}` : '',
  `  ${r.n} 封（他发来 ${r.dirs?.in ?? '?'} · 你发去 ${r.dirs?.out ?? '?'}），${r.first_at} → ${r.last_at}`,
  `  主题：${(r.subjects || []).filter(Boolean).slice(0, 4).map((s) => `「${s}」`).join('　')}`,
].filter(Boolean).join('\n')).join('\n\n')}

**最常见的情形**：你写信给某机构的公用信箱，机构里某个具体的人用自己的
地址、另起一封新信回你。主题里往往还留着原来那件事的名字。

判据：
· 主题说的就是那条线在谈的事 → 命中
· 地址域名跟那条线的机构对得上 → 加分
· **两样都对不上就别列**。挂错了那条线的往来就混进别人的事，比空着糟。
· 一个地址只归一条线；拿不准给 low

**最后一行**单独输出，别的什么都不要加：
[[WHOSE]] {"whose":[{"email":"…","pursuit":"上面那个 8 位短号","why":"凭什么","confidence":"high|low"}]}
一个都对不上就输出 [[WHOSE]] {"whose":[]}`)

  const m = text.match(/\[\[WHOSE\]\]\s*(\{[\s\S]*\})\s*$/)
  if (!m) return { checked: rows.length, note: '它没按格式回话，这轮不动任何东西' }
  let list = []
  try { list = JSON.parse(m[1]).whose || [] } catch (_) { list = [] }

  const shortId = new Map(pursuits.map((p) => [p.id.slice(0, 8), p]))
  const byEmail = new Map(rows.map((r) => [r.email, r]))

  const high = [], low = []
  for (const x of list) {
    const p = shortId.get(String(x?.pursuit || '').trim())
    const r = byEmail.get(String(x?.email || '').trim().toLowerCase())
    if (!p || !r) continue
    ;(x.confidence === 'high' ? high : low).push({
      email: r.email, contact_id: r.contact_id, mailbox: r.is_mailbox ? r.email : null,
      pursuit_id: p.id, title: p.title, why: x.why,
    })
  }
  log(`  高把握 ${high.length}｜没把握 ${low.length}`)

  const attached = []
  if (apply) {
    for (const h of high) {
      // 还没进通讯录的人挂不上——挂之前得先有张卡。那一步是你点头的，
      // 不该在后台替你做。所以这种只报出来，不硬挂。
      if (!h.contact_id && !h.mailbox) {
        log(`  · ${h.email} → ${h.title}：还没进通讯录，先去「等你点头」认一下`)
        continue
      }
      try {
        await rpc('pa_attach_party', {
          p_pursuit_id: h.pursuit_id, p_contact_id: h.contact_id,
          p_mailbox: h.mailbox, p_note: h.why, p_by: 'fairwind',
        })
        attached.push(h)
        log(`  ✓ ${h.title} ← ${h.email}`)
      } catch (err) { log(`  ✗ ${h.email}：${err.message}`) }
    }
  }
  // highs 带出名单，不只带个数 —— 只报「高把握 2」的话，查不出是哪两个、
  // 也看不出它把谁归到了哪条线上。
  return { checked: rows.length, high: high.length, highs: high, low, attached, applied: apply }
}
